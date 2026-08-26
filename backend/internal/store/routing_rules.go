package store

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"easyproxy/internal/model"
)

func (s *Store) ListRecognitionRules() ([]model.RecognitionRule, error) {
	rows, err := s.db.Query(`SELECT id,name,kind,conditions,source_url,source_behavior,source_interval,priority,enabled
		FROM recognition_rules ORDER BY priority DESC,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.RecognitionRule{}
	for rows.Next() {
		var rule model.RecognitionRule
		var conditions string
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Kind, &conditions, &rule.SourceURL, &rule.SourceBehavior, &rule.SourceInterval, &rule.Priority, &rule.Enabled); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(conditions), &rule.Conditions)
		if rule.Conditions == nil {
			rule.Conditions = []string{}
		}
		out = append(out, rule)
	}
	return out, rows.Err()
}

func (s *Store) ListOutboundRules() ([]model.OutboundRule, error) {
	rows, err := s.db.Query(`SELECT id,recognition_id,group_id,enabled FROM outbound_rules ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.OutboundRule{}
	for rows.Next() {
		var rule model.OutboundRule
		if err := rows.Scan(&rule.ID, &rule.RecognitionID, &rule.GroupID, &rule.Enabled); err != nil {
			return nil, err
		}
		out = append(out, rule)
	}
	return out, rows.Err()
}

func cleanRecognitionRule(rule *model.RecognitionRule) error {
	rule.Name = strings.TrimSpace(rule.Name)
	rule.Kind = strings.ToUpper(strings.TrimSpace(rule.Kind))
	if rule.Name == "" {
		return fmt.Errorf("识别规则名称不能为空")
	}
	rule.SourceURL = model.NormalizeGitHubContentURL(rule.SourceURL)
	rule.SourceBehavior = strings.ToLower(strings.TrimSpace(rule.SourceBehavior))
	if rule.SourceURL != "" {
		if strings.ContainsAny(rule.Name, ",\r\n") {
			return fmt.Errorf("远程识别规则名称不能包含逗号或换行：%s", rule.Name)
		}
		u, err := url.Parse(rule.SourceURL)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("识别规则「%s」的 YAML 来源 URL 无效", rule.Name)
		}
		if strings.HasSuffix(strings.ToLower(u.Path), ".mrs") {
			return fmt.Errorf("识别规则「%s」不再支持 MRS 来源", rule.Name)
		}
		if !validRuleProviderBehavior(rule.SourceBehavior) {
			return fmt.Errorf("识别规则「%s」的 YAML 匹配类型无效", rule.Name)
		}
		if rule.SourceInterval <= 0 {
			rule.SourceInterval = 86400
		}
		rule.Kind = "RULE-SET"
		rule.Conditions = []string{}
		return nil
	}
	if rule.Kind == "RULE-SET" {
		return fmt.Errorf("RULE-SET 识别规则必须通过 YAML 规则源导入")
	}
	rule.SourceBehavior = ""
	rule.SourceInterval = 0
	if !validRecognitionKind(rule.Kind) {
		return fmt.Errorf("不支持的识别范围：%s", rule.Kind)
	}
	seen := map[string]bool{}
	conditions := make([]string, 0, len(rule.Conditions))
	for _, value := range rule.Conditions {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		conditions = append(conditions, value)
	}
	if rule.Kind == "MATCH" {
		conditions = []string{}
	} else if len(conditions) == 0 {
		return fmt.Errorf("识别规则「%s」至少需要一个匹配条件", rule.Name)
	}
	rule.Conditions = conditions
	return nil
}

func validRuleProviderBehavior(behavior string) bool {
	switch behavior {
	case "domain", "ipcidr", "classical":
		return true
	}
	return false
}

func validRecognitionKind(kind string) bool {
	switch kind {
	case "DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "DOMAIN-REGEX",
		"IP-CIDR", "IP-CIDR6", "GEOIP", "GEOSITE", "SRC-IP-CIDR",
		"SRC-PORT", "DST-PORT", "PROCESS-NAME", "PROCESS-PATH", "IN-TYPE", "MATCH":
		return true
	default:
		return false
	}
}

// CreateRecognitionRules 原子追加识别规则，用于远程 YAML 来源批量导入。
// 任一规则无效或名称冲突时不会写入任何记录。
func (s *Store) CreateRecognitionRules(rules []model.RecognitionRule) ([]model.RecognitionRule, error) {
	if len(rules) == 0 {
		return nil, fmt.Errorf("没有可导入的识别规则")
	}
	cleaned := make([]model.RecognitionRule, 0, len(rules))
	names := map[string]bool{}
	for _, rule := range rules {
		if err := cleanRecognitionRule(&rule); err != nil {
			return nil, err
		}
		if names[rule.Name] {
			return nil, fmt.Errorf("导入内容中存在重复的识别规则名称：%s", rule.Name)
		}
		names[rule.Name] = true
		cleaned = append(cleaned, rule)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for name := range names {
		var exists bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM recognition_rules WHERE name=?)`, name).Scan(&exists); err != nil {
			return nil, err
		}
		if exists {
			return nil, fmt.Errorf("识别规则名称已存在：%s", name)
		}
	}
	for i := range cleaned {
		conditions, err := json.Marshal(cleaned[i].Conditions)
		if err != nil {
			return nil, err
		}
		result, err := tx.Exec(`INSERT INTO recognition_rules(name,kind,conditions,source_url,source_behavior,source_interval,priority,enabled)
			VALUES(?,?,?,?,?,?,?,?)`, cleaned[i].Name, cleaned[i].Kind, string(conditions), cleaned[i].SourceURL,
			cleaned[i].SourceBehavior, cleaned[i].SourceInterval, cleaned[i].Priority, cleaned[i].Enabled)
		if err != nil {
			return nil, err
		}
		cleaned[i].ID, _ = result.LastInsertId()
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return cleaned, nil
}

// ReplaceRecognitionRules 原子保存识别规则；被出站映射引用的规则需先解除映射后才能删除。
func (s *Store) ReplaceRecognitionRules(rules []model.RecognitionRule) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	existing := map[int64]bool{}
	rows, err := tx.Query(`SELECT id FROM recognition_rules`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		existing[id] = true
	}
	if err := rows.Close(); err != nil {
		return err
	}

	kept := map[int64]bool{}
	names := map[string]bool{}
	for i := range rules {
		rule := rules[i]
		if err := cleanRecognitionRule(&rule); err != nil {
			return err
		}
		if names[rule.Name] {
			return fmt.Errorf("识别规则名称重复：%s", rule.Name)
		}
		names[rule.Name] = true
		conditions, err := json.Marshal(rule.Conditions)
		if err != nil {
			return err
		}
		if rule.ID > 0 {
			if !existing[rule.ID] {
				return fmt.Errorf("识别规则 ID %d 不存在", rule.ID)
			}
			if _, err := tx.Exec(`UPDATE recognition_rules SET name=?,kind=?,conditions=?,source_url=?,source_behavior=?,source_interval=?,priority=?,enabled=? WHERE id=?`,
				rule.Name, rule.Kind, string(conditions), rule.SourceURL, rule.SourceBehavior, rule.SourceInterval, rule.Priority, rule.Enabled, rule.ID); err != nil {
				return err
			}
			kept[rule.ID] = true
			continue
		}
		result, err := tx.Exec(`INSERT INTO recognition_rules(name,kind,conditions,source_url,source_behavior,source_interval,priority,enabled) VALUES(?,?,?,?,?,?,?,?)`,
			rule.Name, rule.Kind, string(conditions), rule.SourceURL, rule.SourceBehavior, rule.SourceInterval, rule.Priority, rule.Enabled)
		if err != nil {
			return err
		}
		id, _ := result.LastInsertId()
		kept[id] = true
	}
	for id := range existing {
		if kept[id] {
			continue
		}
		var references int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM outbound_rules WHERE recognition_id=?`, id).Scan(&references); err != nil {
			return err
		}
		if references > 0 {
			return fmt.Errorf("识别规则仍被 %d 条出站映射引用，无法删除", references)
		}
		if _, err := tx.Exec(`DELETE FROM recognition_rules WHERE id=?`, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ReplaceOutboundRules 保存识别规则到节点组合的唯一映射。
func (s *Store) ReplaceOutboundRules(rules []model.OutboundRule) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	existing := map[int64]bool{}
	rows, err := tx.Query(`SELECT id FROM outbound_rules`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		existing[id] = true
	}
	if err := rows.Close(); err != nil {
		return err
	}

	kept := map[int64]bool{}
	recognitions := map[int64]bool{}
	for _, rule := range rules {
		if rule.RecognitionID <= 0 || (rule.GroupID <= 0 && !model.IsBuiltinOutboundTarget(rule.GroupID)) {
			return fmt.Errorf("出站映射必须选择识别规则和出站目标")
		}
		if recognitions[rule.RecognitionID] {
			return fmt.Errorf("同一识别规则只能映射到一个节点组合")
		}
		recognitions[rule.RecognitionID] = true
		var recognitionExists bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM recognition_rules WHERE id=?)`, rule.RecognitionID).Scan(&recognitionExists); err != nil || !recognitionExists {
			return fmt.Errorf("识别规则不存在")
		}
		if !model.IsBuiltinOutboundTarget(rule.GroupID) {
			var groupExists bool
			if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM proxy_groups WHERE id=?)`, rule.GroupID).Scan(&groupExists); err != nil || !groupExists {
				return fmt.Errorf("节点组合不存在")
			}
		}
		if rule.ID > 0 {
			if !existing[rule.ID] {
				return fmt.Errorf("出站映射 ID %d 不存在", rule.ID)
			}
			if _, err := tx.Exec(`UPDATE outbound_rules SET recognition_id=?,group_id=?,enabled=? WHERE id=?`, rule.RecognitionID, rule.GroupID, rule.Enabled, rule.ID); err != nil {
				return err
			}
			kept[rule.ID] = true
			continue
		}
		result, err := tx.Exec(`INSERT INTO outbound_rules(recognition_id,group_id,enabled) VALUES(?,?,?)`, rule.RecognitionID, rule.GroupID, rule.Enabled)
		if err != nil {
			return err
		}
		id, _ := result.LastInsertId()
		kept[id] = true
	}
	for id := range existing {
		if kept[id] {
			continue
		}
		if _, err := tx.Exec(`DELETE FROM outbound_rules WHERE id=?`, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
