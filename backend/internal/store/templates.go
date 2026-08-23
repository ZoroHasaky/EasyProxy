package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
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
	rows, err := s.db.Query(`SELECT id,template_id,kind,value,target,base_target,target_override,no_resolve,position,enabled
		FROM rules WHERE template_id=? ORDER BY position,id`, templateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Rule{}
	for rows.Next() {
		var r model.Rule
		if err := rows.Scan(&r.ID, &r.TemplateID, &r.Kind, &r.Value, &r.Target, &r.BaseTarget,
			&r.TargetOverride, &r.NoResolve, &r.Position, &r.Enabled); err != nil {
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

func (s *Store) ListCurrentRules() ([]model.Rule, error) {
	return s.ListRules(0)
}

func (s *Store) ListCurrentRuleProviders() ([]model.RuleProvider, error) {
	return s.ListRuleProviders(0)
}

func (s *Store) GetCurrentRuleProvider(id int64) (*model.RuleProvider, error) {
	var p model.RuleProvider
	err := s.db.QueryRow(`SELECT id,template_id,name,url,behavior,format,interval
		FROM rule_providers WHERE template_id=0 AND id=?`, id).
		Scan(&p.ID, &p.TemplateID, &p.Name, &p.URL, &p.Behavior, &p.Format, &p.Interval)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ReplaceCurrentRules 原子保存唯一的当前规则集。规则集来源按 ID 更新，避免编辑后 ID 变化；
// 来源改名会联动 RULE-SET 引用，仍被引用的来源不能删除。
func (s *Store) ReplaceCurrentRules(rules []model.Rule, providers []model.RuleProvider) error {
	providerNames := map[string]bool{}
	for i := range providers {
		p := &providers[i]
		p.Name = strings.TrimSpace(p.Name)
		p.URL = strings.TrimSpace(p.URL)
		p.Behavior = strings.ToLower(strings.TrimSpace(p.Behavior))
		p.Format = strings.ToLower(strings.TrimSpace(p.Format))
		if p.Name == "" || p.URL == "" || providerNames[p.Name] {
			return fmt.Errorf("规则集来源名称或 URL 为空，或名称重复")
		}
		if strings.ContainsAny(p.Name, ",\r\n") {
			return fmt.Errorf("规则集来源名称不能包含逗号或换行：%s", p.Name)
		}
		providerNames[p.Name] = true
		switch p.Behavior {
		case "domain", "ipcidr", "classical":
		default:
			return fmt.Errorf("规则集来源 %s 的匹配类型无效", p.Name)
		}
		switch p.Format {
		case "yaml", "text", "mrs":
		default:
			return fmt.Errorf("规则集来源 %s 的格式无效", p.Name)
		}
		if p.Interval <= 0 {
			p.Interval = 86400
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	existing := map[int64]string{}
	rows, err := tx.Query(`SELECT id,name FROM rule_providers WHERE template_id=0`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			rows.Close()
			return err
		}
		existing[id] = name
	}
	if err := rows.Close(); err != nil {
		return err
	}

	renames := map[string]string{}
	kept := map[int64]bool{}
	existingNames := map[string]bool{}
	for _, name := range existing {
		existingNames[name] = true
	}
	for _, p := range providers {
		if p.ID <= 0 {
			continue
		}
		oldName, ok := existing[p.ID]
		if !ok {
			return fmt.Errorf("规则集来源 ID %d 不存在", p.ID)
		}
		kept[p.ID] = true
		if oldName != p.Name {
			renames[oldName] = p.Name
		}
	}
	for i := range rules {
		r := &rules[i]
		r.Kind = strings.ToUpper(strings.TrimSpace(r.Kind))
		if r.Kind == "RULE-SET" {
			if renamed := renames[r.Value]; renamed != "" {
				r.Value = renamed
			}
		}
		if r.Kind == "" || r.Target == "" {
			return fmt.Errorf("存在缺少类型或处理方式的规则")
		}
		if r.BaseTarget == "" {
			r.BaseTarget = r.Target
		}
		r.TargetOverride = r.Target != r.BaseTarget
	}
	missingReferences := map[string]int{}
	for _, r := range rules {
		if r.Kind == "RULE-SET" && !providerNames[r.Value] {
			missingReferences[r.Value]++
		}
	}
	for name, count := range missingReferences {
		if existingNames[name] {
			return fmt.Errorf("规则集来源 %s 仍被 %d 条规则引用，不能删除", name, count)
		}
		return fmt.Errorf("规则集规则引用了不存在的来源：%s", name)
	}

	for _, p := range providers {
		if p.ID > 0 {
			if _, err := tx.Exec(`UPDATE rule_providers SET name=?,url=?,behavior=?,format=?,interval=?
				WHERE template_id=0 AND id=?`, p.Name, p.URL, p.Behavior, p.Format, p.Interval, p.ID); err != nil {
				return err
			}
			continue
		}
		if _, err := tx.Exec(`INSERT INTO rule_providers(template_id,name,url,behavior,format,interval)
			VALUES(0,?,?,?,?,?)`, p.Name, p.URL, p.Behavior, p.Format, p.Interval); err != nil {
			return err
		}
	}
	for id := range existing {
		if kept[id] {
			continue
		}
		if _, err := tx.Exec(`DELETE FROM rule_providers WHERE template_id=0 AND id=?`, id); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM rules WHERE template_id=0`); err != nil {
		return err
	}
	for i, r := range rules {
		if _, err := tx.Exec(`INSERT INTO rules(template_id,kind,value,target,base_target,target_override,no_resolve,position,enabled)
			VALUES(0,?,?,?,?,?,?,?,?)`, r.Kind, r.Value, r.Target, r.BaseTarget,
			r.TargetOverride, r.NoResolve, i, r.Enabled); err != nil {
			return err
		}
	}
	return tx.Commit()
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
		if r.BaseTarget == "" {
			r.BaseTarget = r.Target
		}
		r.TargetOverride = r.Target != r.BaseTarget
		if _, err := tx.Exec(`INSERT INTO rules(template_id,kind,value,target,base_target,target_override,no_resolve,position,enabled)
			VALUES(?,?,?,?,?,?,?,?,?)`, templateID, r.Kind, r.Value, r.Target, r.BaseTarget,
			r.TargetOverride, r.NoResolve, i, r.Enabled); err != nil {
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
