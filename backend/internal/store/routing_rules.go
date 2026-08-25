package store

import (
	"encoding/json"
	"fmt"
	"strings"

	"easyproxy/internal/model"
)

func (s *Store) ListRecognitionRules() ([]model.RecognitionRule, error) {
	rows, err := s.db.Query(`SELECT id,name,kind,conditions,priority,enabled
		FROM recognition_rules ORDER BY priority DESC,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.RecognitionRule{}
	for rows.Next() {
		var rule model.RecognitionRule
		var conditions string
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Kind, &conditions, &rule.Priority, &rule.Enabled); err != nil {
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

// ReplaceRecognitionRules 原子保存识别规则；被出站规则引用的规则需先解除映射后才能删除。
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
			if _, err := tx.Exec(`UPDATE recognition_rules SET name=?,kind=?,conditions=?,priority=?,enabled=? WHERE id=?`,
				rule.Name, rule.Kind, string(conditions), rule.Priority, rule.Enabled, rule.ID); err != nil {
				return err
			}
			kept[rule.ID] = true
			continue
		}
		result, err := tx.Exec(`INSERT INTO recognition_rules(name,kind,conditions,priority,enabled) VALUES(?,?,?,?,?)`,
			rule.Name, rule.Kind, string(conditions), rule.Priority, rule.Enabled)
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
			return fmt.Errorf("识别规则仍被 %d 条出站规则引用，无法删除", references)
		}
		if _, err := tx.Exec(`DELETE FROM recognition_rules WHERE id=?`, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ReplaceOutboundRules 保存识别规则到策略组的唯一映射。
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
		if rule.RecognitionID <= 0 || rule.GroupID <= 0 {
			return fmt.Errorf("出站规则必须选择识别规则和策略组")
		}
		if recognitions[rule.RecognitionID] {
			return fmt.Errorf("同一识别规则只能映射到一个策略组")
		}
		recognitions[rule.RecognitionID] = true
		var recognitionExists, groupExists bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM recognition_rules WHERE id=?)`, rule.RecognitionID).Scan(&recognitionExists); err != nil || !recognitionExists {
			return fmt.Errorf("识别规则不存在")
		}
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM proxy_groups WHERE id=?)`, rule.GroupID).Scan(&groupExists); err != nil || !groupExists {
			return fmt.Errorf("策略组不存在")
		}
		if rule.ID > 0 {
			if !existing[rule.ID] {
				return fmt.Errorf("出站规则 ID %d 不存在", rule.ID)
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
