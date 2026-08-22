package store

import (
	"database/sql"
	"encoding/json"
	"strconv"
	"time"

	"easyproxy/internal/model"
)

func (s *Store) activeTemplateID() int64 {
	return int64(s.GetSettingInt("active_template_id", 0))
}

func (s *Store) ListTemplates() ([]model.Template, error) {
	rows, err := s.db.Query(`SELECT id,name,source,url,content,mapping,COALESCE(updated_at,'') FROM templates ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	activeID := s.activeTemplateID()
	out := []model.Template{}
	for rows.Next() {
		var t model.Template
		var mapping, updated string
		if err := rows.Scan(&t.ID, &t.Name, &t.Source, &t.URL, &t.Content, &mapping, &updated); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(mapping), &t.Mapping)
		if t.Mapping == nil {
			t.Mapping = map[string]string{}
		}
		t.Active = activeID == t.ID
		t.UpdatedAt = parseTime(updated)
		out = append(out, t)
	}
	return out, nil
}

func (s *Store) GetTemplate(id int64) (*model.Template, error) {
	var t model.Template
	var mapping, updated string
	err := s.db.QueryRow(`SELECT id,name,source,url,content,mapping,COALESCE(updated_at,'') FROM templates WHERE id=?`, id).
		Scan(&t.ID, &t.Name, &t.Source, &t.URL, &t.Content, &mapping, &updated)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(mapping), &t.Mapping)
	if t.Mapping == nil {
		t.Mapping = map[string]string{}
	}
	t.Active = s.activeTemplateID() == t.ID
	t.UpdatedAt = parseTime(updated)
	return &t, nil
}

// GetActiveTemplate 返回当前激活模板；无激活但有模板时自动激活第一个
func (s *Store) GetActiveTemplate() (*model.Template, error) {
	id := s.activeTemplateID()
	if id != 0 {
		if t, err := s.GetTemplate(id); err == nil {
			return t, nil
		}
	}
	var firstID int64
	err := s.db.QueryRow(`SELECT id FROM templates ORDER BY id LIMIT 1`).Scan(&firstID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = s.SetSetting("active_template_id", strconv.FormatInt(firstID, 10))
	return s.GetTemplate(firstID)
}

func (s *Store) CreateTemplate(t *model.Template) error {
	mapping, _ := json.Marshal(t.Mapping)
	now := time.Now().Format(time.RFC3339)
	res, err := s.db.Exec(`INSERT INTO templates(name,source,url,content,mapping,updated_at) VALUES(?,?,?,?,?,?)`,
		t.Name, t.Source, t.URL, t.Content, string(mapping), now)
	if err != nil {
		return err
	}
	t.ID, _ = res.LastInsertId()
	t.UpdatedAt = time.Now()
	// 第一个模板自动激活
	var cnt int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM templates`).Scan(&cnt)
	if cnt <= 1 {
		_ = s.SetSetting("active_template_id", strconv.FormatInt(t.ID, 10))
		t.Active = true
	} else {
		t.Active = s.activeTemplateID() == t.ID
	}
	return nil
}

func (s *Store) UpdateTemplate(t *model.Template) error {
	mapping, _ := json.Marshal(t.Mapping)
	_, err := s.db.Exec(`UPDATE templates SET name=?,source=?,url=?,content=?,mapping=?,updated_at=? WHERE id=?`,
		t.Name, t.Source, t.URL, t.Content, string(mapping), time.Now().Format(time.RFC3339), t.ID)
	return err
}

func (s *Store) DeleteTemplate(id int64) error {
	if _, err := s.db.Exec(`DELETE FROM rules WHERE template_id=?`, id); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM rule_providers WHERE template_id=?`, id); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM templates WHERE id=?`, id)
	if s.activeTemplateID() == id {
		_ = s.SetSetting("active_template_id", "0")
	}
	return err
}

func (s *Store) ActivateTemplate(id int64) error {
	return s.SetSetting("active_template_id", strconv.FormatInt(id, 10))
}

// ---------- rules & providers ----------

func (s *Store) ListRules(templateID int64) ([]model.Rule, error) {
	rows, err := s.db.Query(`SELECT id,template_id,kind,value,target,no_resolve,position,enabled
		FROM rules WHERE template_id=? ORDER BY position,id`, templateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Rule{}
	for rows.Next() {
		var r model.Rule
		if err := rows.Scan(&r.ID, &r.TemplateID, &r.Kind, &r.Value, &r.Target, &r.NoResolve, &r.Position, &r.Enabled); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

func (s *Store) ListRuleProviders(templateID int64) ([]model.RuleProvider, error) {
	rows, err := s.db.Query(`SELECT id,template_id,name,url,behavior,format,interval
		FROM rule_providers WHERE template_id=? ORDER BY name`, templateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.RuleProvider{}
	for rows.Next() {
		var p model.RuleProvider
		if err := rows.Scan(&p.ID, &p.TemplateID, &p.Name, &p.URL, &p.Behavior, &p.Format, &p.Interval); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// ReplaceRules 整体替换某模板的规则与 rule-providers（事务）
func (s *Store) ReplaceRules(templateID int64, rules []model.Rule, providers []model.RuleProvider) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM rules WHERE template_id=?`, templateID); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM rule_providers WHERE template_id=?`, templateID); err != nil {
		return err
	}
	for i := range rules {
		r := rules[i]
		if _, err := tx.Exec(`INSERT INTO rules(template_id,kind,value,target,no_resolve,position,enabled)
			VALUES(?,?,?,?,?,?,?)`, templateID, r.Kind, r.Value, r.Target, r.NoResolve, i, r.Enabled); err != nil {
			return err
		}
	}
	for _, p := range providers {
		if _, err := tx.Exec(`INSERT INTO rule_providers(template_id,name,url,behavior,format,interval)
			VALUES(?,?,?,?,?,?)`, templateID, p.Name, p.URL, p.Behavior, p.Format, p.Interval); err != nil {
			return err
		}
	}
	return tx.Commit()
}
