package store

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"easyproxy/internal/model"
)

const defaultProxyPortName = "默认端口"

// initializeProxyPorts creates the built-in 7890 entry for existing installs and
// copies the current global outbound mappings once so enabling the feature is
// behavior-preserving.
func (s *Store) initializeProxyPorts() error {
	var id int64
	var port int
	err := s.db.QueryRow(`SELECT id,port FROM proxy_ports WHERE is_default=1 LIMIT 1`).Scan(&id, &port)
	if err == sql.ErrNoRows {
		port = s.GetSettingInt("mixed_port", 7890)
		if port < 1 || port > 65535 {
			port = 7890
		}
		result, err := s.db.Exec(`INSERT INTO proxy_ports(name,port,enabled,is_default,default_target,position) VALUES(?,?,?,?,?,?)`, defaultProxyPortName, port, 1, 1, "PROXY", 0)
		if err != nil {
			return err
		}
		id, err = result.LastInsertId()
		if err != nil {
			return err
		}
		if err := s.SetSetting("mixed_port", strconv.Itoa(port)); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		configured := s.GetSettingInt("mixed_port", port)
		if configured >= 1 && configured <= 65535 && configured != port {
			if _, err := s.db.Exec(`UPDATE proxy_ports SET port=? WHERE id=?`, configured, id); err != nil {
				return err
			}
			port = configured
		} else if s.GetSetting("mixed_port", "") == "" {
			if err := s.SetSetting("mixed_port", strconv.Itoa(port)); err != nil {
				return err
			}
		}
	}

	var ruleCount int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM proxy_port_rules WHERE port_id=?`, id).Scan(&ruleCount); err != nil {
		return err
	}
	if ruleCount > 0 {
		return nil
	}
	rows, err := s.db.Query(`SELECT recognition_id,group_id,enabled FROM outbound_rules ORDER BY id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var recognitionID, groupID int64
		var enabled bool
		if err := rows.Scan(&recognitionID, &groupID, &enabled); err != nil {
			return err
		}
		if _, err := s.db.Exec(`INSERT INTO proxy_port_rules(port_id,recognition_id,group_id,target,enabled) VALUES(?,?,?,?,?)`, id, recognitionID, groupID, legacyProxyPortTarget(groupID), enabled); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (s *Store) ListProxyPorts() ([]model.ProxyPort, error) {
	rows, err := s.db.Query(`SELECT id,name,port,enabled,is_default,default_target,position FROM proxy_ports ORDER BY position,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ports := []model.ProxyPort{}
	for rows.Next() {
		var port model.ProxyPort
		if err := rows.Scan(&port.ID, &port.Name, &port.Port, &port.Enabled, &port.IsDefault, &port.DefaultTarget, &port.Position); err != nil {
			return nil, err
		}
		port.Rules = []model.ProxyPortRule{}
		ports = append(ports, port)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range ports {
		ruleRows, err := s.db.Query(`SELECT p.recognition_id,p.group_id,p.target,p.enabled
		FROM proxy_port_rules p JOIN recognition_rules r ON r.id=p.recognition_id
		WHERE p.port_id=? ORDER BY r.priority DESC,r.id`, ports[i].ID)
		if err != nil {
			return nil, err
		}
		for ruleRows.Next() {
			var rule model.ProxyPortRule
			if err := ruleRows.Scan(&rule.RecognitionID, &rule.GroupID, &rule.Target, &rule.Enabled); err != nil {
				ruleRows.Close()
				return nil, err
			}
			if strings.TrimSpace(rule.Target) == "" {
				rule.Target = legacyProxyPortTarget(rule.GroupID)
			}
			ports[i].Rules = append(ports[i].Rules, rule)
		}
		if err := ruleRows.Close(); err != nil {
			return nil, err
		}
	}
	return ports, nil
}

func (s *Store) GetProxyPort(id int64) (*model.ProxyPort, error) {
	ports, err := s.ListProxyPorts()
	if err != nil {
		return nil, err
	}
	for i := range ports {
		if ports[i].ID == id {
			return &ports[i], nil
		}
	}
	return nil, sql.ErrNoRows
}

func validateProxyPortTarget(tx *sql.Tx, target string) error {
	target = strings.TrimSpace(target)
	if model.IsBuiltinTarget(target) {
		return nil
	}
	kind, id, ok := model.ParseTargetRef(target)
	if !ok || id <= 0 {
		return fmt.Errorf("默认出站目标无效")
	}
	table := "proxy_groups"
	if kind == "node" {
		table = "nodes"
	} else if kind != "group" {
		return fmt.Errorf("默认出站目标无效")
	}
	var exists bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM `+table+` WHERE id=?)`, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("默认出站目标不存在")
	}
	return nil
}

func validateProxyPortNumber(port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("端口必须在 1 到 65535 之间")
	}
	return nil
}

const (
	panelListenPort       = 8080
	defaultControllerPort = 9095
	defaultDNSProxyPort   = 1053
	transparentDNSPort    = 53
)

func legacyProxyPortTarget(groupID int64) string {
	if target, ok := model.BuiltinOutboundTarget(groupID); ok {
		return target
	}
	if groupID > 0 {
		return model.GroupTargetRef(groupID)
	}
	return ""
}

func targetGroupID(target string) int64 {
	switch strings.TrimSpace(target) {
	case model.BuiltinDirect:
		return model.OutboundTargetDirectID
	case model.BuiltinReject:
		return model.OutboundTargetRejectID
	case "PROXY":
		return model.OutboundTargetProxyID
	}
	if kind, id, ok := model.ParseTargetRef(target); ok && kind == "group" {
		return id
	}
	return 0
}

func (s *Store) validateProxyPortConflicts(tx *sql.Tx, port int, excludeID int64) error {
	if port == panelListenPort {
		return fmt.Errorf("端口 %d 已被面板占用", port)
	}
	controllerPort := defaultControllerPort
	var rawControllerPort string
	if err := tx.QueryRow(`SELECT value FROM settings WHERE key='controller_port'`).Scan(&rawControllerPort); err == nil {
		if parsed, err := strconv.Atoi(rawControllerPort); err == nil && parsed >= 1 && parsed <= 65535 {
			controllerPort = parsed
		}
	}
	if port == controllerPort {
		return fmt.Errorf("端口 %d 已被 Mihomo 控制器占用", port)
	}
	if port == defaultDNSProxyPort || port == transparentDNSPort {
		return fmt.Errorf("端口 %d 已被 DNS 监听占用", port)
	}
	var duplicate bool
	query := `SELECT EXISTS(SELECT 1 FROM proxy_ports WHERE port=? AND id<>?)`
	if err := tx.QueryRow(query, port, excludeID).Scan(&duplicate); err != nil {
		return err
	}
	if duplicate {
		return fmt.Errorf("端口 %d 已存在", port)
	}
	return nil
}

func (s *Store) CreateProxyPort(port *model.ProxyPort) error {
	if port == nil {
		return fmt.Errorf("端口不能为空")
	}
	if err := validateProxyPortNumber(port.Port); err != nil {
		return err
	}
	port.Name = strings.TrimSpace(port.Name)
	if port.Name == "" {
		port.Name = fmt.Sprintf("端口 %d", port.Port)
	}
	if port.DefaultTarget == "" {
		port.DefaultTarget = "PROXY"
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := validateProxyPortTarget(tx, port.DefaultTarget); err != nil {
		return err
	}
	if err := s.validateProxyPortConflicts(tx, port.Port, 0); err != nil {
		return err
	}
	var maxPosition int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(position),0) FROM proxy_ports`).Scan(&maxPosition); err != nil {
		return err
	}
	result, err := tx.Exec(`INSERT INTO proxy_ports(name,port,enabled,is_default,default_target,position) VALUES(?,?,?,?,?,?)`, port.Name, port.Port, port.Enabled, 0, port.DefaultTarget, maxPosition+1)
	if err != nil {
		return err
	}
	port.ID, err = result.LastInsertId()
	if err != nil {
		return err
	}
	port.IsDefault = false
	port.Position = maxPosition + 1
	return tx.Commit()
}

// UpdateDefaultProxyPort keeps the legacy mixed_port setting and the built-in
// port record in sync when the existing kernel page edits 7890.
func (s *Store) UpdateDefaultProxyPort(port int) error {
	if err := validateProxyPortNumber(port); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var defaultID int64
	if err := tx.QueryRow(`SELECT id FROM proxy_ports WHERE is_default=1 LIMIT 1`).Scan(&defaultID); err != nil {
		return err
	}
	if err := s.validateProxyPortConflicts(tx, port, defaultID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE proxy_ports SET port=? WHERE is_default=1`, port); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO settings(key,value) VALUES('mixed_port',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, strconv.Itoa(port)); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UpdateProxyPort(port *model.ProxyPort) error {
	if port == nil || port.ID <= 0 {
		return fmt.Errorf("端口无效")
	}
	if err := validateProxyPortNumber(port.Port); err != nil {
		return err
	}
	port.Name = strings.TrimSpace(port.Name)
	if port.Name == "" {
		return fmt.Errorf("端口名称不能为空")
	}
	if port.DefaultTarget == "" {
		port.DefaultTarget = "PROXY"
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var isDefault bool
	if err := tx.QueryRow(`SELECT is_default FROM proxy_ports WHERE id=?`, port.ID).Scan(&isDefault); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("端口不存在")
		}
		return err
	}
	if err := validateProxyPortTarget(tx, port.DefaultTarget); err != nil {
		return err
	}
	if err := s.validateProxyPortConflicts(tx, port.Port, port.ID); err != nil {
		return err
	}
	if isDefault {
		if _, err := tx.Exec(`UPDATE proxy_ports SET name=?,port=?,enabled=?,default_target=? WHERE id=?`, port.Name, port.Port, port.Enabled, port.DefaultTarget, port.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO settings(key,value) VALUES('mixed_port',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, strconv.Itoa(port.Port)); err != nil {
			return err
		}
	} else if _, err := tx.Exec(`UPDATE proxy_ports SET name=?,port=?,enabled=?,default_target=? WHERE id=?`, port.Name, port.Port, port.Enabled, port.DefaultTarget, port.ID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteProxyPort(id int64) error {
	if id <= 0 {
		return fmt.Errorf("端口无效")
	}
	var isDefault bool
	if err := s.db.QueryRow(`SELECT is_default FROM proxy_ports WHERE id=?`, id).Scan(&isDefault); err != nil {
		if err == sql.ErrNoRows {
			return fmt.Errorf("端口不存在")
		}
		return err
	}
	if isDefault {
		return fmt.Errorf("默认端口不能删除")
	}
	_, err := s.db.Exec(`DELETE FROM proxy_ports WHERE id=?`, id)
	return err
}

func (s *Store) ReplaceProxyPortRules(portID int64, rules []model.ProxyPortRule) error {
	if portID <= 0 {
		return fmt.Errorf("端口无效")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM proxy_ports WHERE id=?)`, portID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("端口不存在")
	}
	seen := make(map[int64]bool, len(rules))
	for i := range rules {
		rule := &rules[i]
		if rule.RecognitionID <= 0 || seen[rule.RecognitionID] {
			return fmt.Errorf("端口规则中的识别规则无效或重复")
		}
		seen[rule.RecognitionID] = true
		var recognitionExists bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM recognition_rules WHERE id=?)`, rule.RecognitionID).Scan(&recognitionExists); err != nil {
			return err
		}
		if !recognitionExists {
			return fmt.Errorf("识别规则 %d 不存在", rule.RecognitionID)
		}
		if strings.TrimSpace(rule.Target) == "" {
			rule.Target = legacyProxyPortTarget(rule.GroupID)
		}
		if err := validateProxyPortTarget(tx, rule.Target); err != nil {
			return fmt.Errorf("端口规则目标无效: %w", err)
		}
		rule.GroupID = targetGroupID(rule.Target)
	}
	if _, err := tx.Exec(`DELETE FROM proxy_port_rules WHERE port_id=?`, portID); err != nil {
		return err
	}
	for _, rule := range rules {
		if _, err := tx.Exec(`INSERT INTO proxy_port_rules(port_id,recognition_id,group_id,target,enabled) VALUES(?,?,?,?,?)`, portID, rule.RecognitionID, rule.GroupID, rule.Target, rule.Enabled); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// TouchProxyPortsRevision lets the existing pending-config machinery detect
// port CRUD changes without storing the whole port model in settings.
func (s *Store) TouchProxyPortsRevision() ([]PendingConfigChange, error) {
	revision := s.GetSettingInt("proxy_ports_revision", 0) + 1
	return s.UpdateConfigSettingsAndSyncPending(map[string]string{
		"proxy_ports_revision": strconv.Itoa(revision),
	})
}
