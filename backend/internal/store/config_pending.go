package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

const (
	ConfigScopeKernelNetwork    = "kernel_network"
	ConfigScopeTransparentProxy = "transparent_proxy"
	ConfigScopeGeo              = "geo"

	PendingConfigStatusPending = "pending"
	PendingConfigStatusFailed  = "failed"
)

// PendingConfigChange 是一组已保存、尚未写入运行内核的配置变更。
// Fields 使用设置键名，供调用方映射为本地化文案并展示具体变更内容。
type PendingConfigChange struct {
	Scope     string   `json:"scope"`
	Fields    []string `json:"fields"`
	Status    string   `json:"status"`
	LastError string   `json:"last_error,omitempty"`
	UpdatedAt string   `json:"updated_at"`
}

var configScopeSettings = map[string][]string{
	ConfigScopeKernelNetwork: {
		"mixed_port", "allow_lan", "log_level",
	},
	ConfigScopeTransparentProxy: {
		"tun_enable", "tun_stack", "dns_enable", "dns_mode", "dns_nameserver", "dns_fallback",
	},
	ConfigScopeGeo: {
		"geo_enabled", "geo_auto_update", "geo_update_interval", "geox_urls",
	},
}

var configSettingDefaults = map[string]string{
	"mixed_port":          "7890",
	"allow_lan":           "1",
	"log_level":           "info",
	"tun_enable":          "0",
	"tun_stack":           "mixed",
	"dns_enable":          "1",
	"dns_mode":            "fake-ip",
	"dns_nameserver":      `["https://223.5.5.5/dns-query","https://doh.pub/dns-query"]`,
	"dns_fallback":        `["223.5.5.5","119.29.29.29"]`,
	"geo_enabled":         "1",
	"geo_auto_update":     "1",
	"geo_update_interval": "24",
}

// ConfigScopes 返回稳定的配置应用范围顺序。
func ConfigScopes() []string {
	return []string{ConfigScopeKernelNetwork, ConfigScopeTransparentProxy, ConfigScopeGeo}
}

// ConfigScopeForSetting 返回指定设置归属的配置应用范围。
func ConfigScopeForSetting(key string) (string, bool) {
	for _, scope := range ConfigScopes() {
		for _, candidate := range configScopeSettings[scope] {
			if candidate == key {
				return scope, true
			}
		}
	}
	return "", false
}

// AppliedConfigSettings 返回最后一次成功应用到内核的设置快照。
func (s *Store) AppliedConfigSettings() (map[string]string, error) {
	return s.readConfigSettings("applied_config_settings")
}

// CurrentConfigSettings 返回当前已保存的目标设置。统一应用会先取得这份快照，
// 再用同一份数据生成 YAML 并在成功后写入 applied_config_settings，避免并发编辑
// 被错误地标记为已经应用。
func (s *Store) CurrentConfigSettings() (map[string]string, error) {
	return s.readConfigSettings("settings")
}

func (s *Store) readConfigSettings(table string) (map[string]string, error) {
	query := `SELECT key,value FROM applied_config_settings ORDER BY key`
	if table == "settings" {
		query = `SELECT key,value FROM settings ORDER BY key`
	}
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	settings := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		settings[key] = value
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, key := range configSettingKeys() {
		if _, ok := settings[key]; !ok {
			settings[key] = configSettingDefault(key)
		}
	}
	return settings, nil
}

// ReplaceAppliedConfigSettings 覆盖已应用快照。调用方应只在配置已成功应用后调用。
func (s *Store) ReplaceAppliedConfigSettings(values map[string]string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, key := range configSettingKeys() {
		value, ok := values[key]
		if !ok {
			value = configSettingDefault(key)
		}
		if _, err := tx.Exec(`INSERT INTO applied_config_settings(key,value) VALUES(?,?)
			ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// AppliedConfigYAML 返回最后一次成功加载到内核的完整配置。它同时固定了当时的
// 节点、订阅与规则数据，防止自动应用失败的数据在随后重启时被意外启用。
func (s *Store) AppliedConfigYAML() (string, error) {
	var yaml string
	err := s.db.QueryRow(`SELECT yaml FROM applied_config_state WHERE id=1`).Scan(&yaml)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return yaml, err
}

// SaveAppliedConfigYAML 仅应在候选配置已成功启动、重启或热重载后调用。
func (s *Store) SaveAppliedConfigYAML(yaml string) error {
	_, err := s.db.Exec(`INSERT INTO applied_config_state(id,yaml) VALUES(1,?)
		ON CONFLICT(id) DO UPDATE SET yaml=excluded.yaml`, yaml)
	return err
}

// CommitAppliedConfig 原子更新设置快照和完整 YAML 快照，用于顶栏统一应用成功后。
func (s *Store) CommitAppliedConfig(values map[string]string, yaml string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, key := range configSettingKeys() {
		value, ok := values[key]
		if !ok {
			value = configSettingDefault(key)
		}
		if _, err := tx.Exec(`INSERT INTO applied_config_settings(key,value) VALUES(?,?)
			ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`INSERT INTO applied_config_state(id,yaml) VALUES(1,?)
		ON CONFLICT(id) DO UPDATE SET yaml=excluded.yaml`, yaml); err != nil {
		return err
	}
	return tx.Commit()
}

// SnapshotCurrentConfigSettings 将当前保存的配置设为已应用快照。
// 它不会清理待应用项，便于调用方在成功应用后按实际范围删除记录。
func (s *Store) SnapshotCurrentConfigSettings() error {
	values, err := s.CurrentConfigSettings()
	if err != nil {
		return err
	}
	return s.ReplaceAppliedConfigSettings(values)
}

// UpdateConfigSettingsAndSyncPending 原子地保存配置项，并按快照同步待应用清单。
// 回退到已应用值的字段会自动从对应范围移除；范围内无差异时整条待应用记录会被删除。
func (s *Store) UpdateConfigSettingsAndSyncPending(values map[string]string) ([]PendingConfigChange, error) {
	if len(values) == 0 {
		return s.ListPendingConfigChanges()
	}
	affected := make(map[string]struct{})
	for key := range values {
		scope, ok := ConfigScopeForSetting(key)
		if !ok {
			return nil, fmt.Errorf("setting %q is not an apply-managed setting", key)
		}
		affected[scope] = struct{}{}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for key, value := range values {
		if _, err := tx.Exec(`INSERT INTO settings(key,value) VALUES(?,?)
			ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
			return nil, err
		}
	}
	for scope := range affected {
		fields, err := pendingFieldsForScope(tx, scope)
		if err != nil {
			return nil, err
		}
		if len(fields) == 0 {
			if _, err := tx.Exec(`DELETE FROM pending_config_changes WHERE scope=?`, scope); err != nil {
				return nil, err
			}
			continue
		}
		encoded, err := json.Marshal(fields)
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(`INSERT INTO pending_config_changes(scope,fields,status,last_error,updated_at)
			VALUES(?,?,?,?,?)
			ON CONFLICT(scope) DO UPDATE SET fields=excluded.fields,status=excluded.status,last_error='',updated_at=excluded.updated_at`,
			scope, string(encoded), PendingConfigStatusPending, "", pendingConfigTimestamp()); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.ListPendingConfigChanges()
}

// UpsertPendingConfigChange 写入或更新一条待应用项。自动应用失败时可将 Status 设为 failed。
func (s *Store) UpsertPendingConfigChange(change PendingConfigChange) error {
	if change.Scope == "" {
		return fmt.Errorf("pending config scope is required")
	}
	if change.Status == "" {
		change.Status = PendingConfigStatusPending
	}
	fields := dedupeAndSort(change.Fields)
	encoded, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	if change.UpdatedAt == "" {
		change.UpdatedAt = pendingConfigTimestamp()
	}
	_, err = s.db.Exec(`INSERT INTO pending_config_changes(scope,fields,status,last_error,updated_at)
		VALUES(?,?,?,?,?)
		ON CONFLICT(scope) DO UPDATE SET fields=excluded.fields,status=excluded.status,last_error=excluded.last_error,updated_at=excluded.updated_at`,
		change.Scope, string(encoded), change.Status, change.LastError, change.UpdatedAt)
	return err
}

func (s *Store) ListPendingConfigChanges() ([]PendingConfigChange, error) {
	rows, err := s.db.Query(`SELECT scope,fields,status,last_error,updated_at FROM pending_config_changes ORDER BY updated_at DESC,scope`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	changes := []PendingConfigChange{}
	for rows.Next() {
		var change PendingConfigChange
		var fields string
		if err := rows.Scan(&change.Scope, &fields, &change.Status, &change.LastError, &change.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(fields), &change.Fields); err != nil {
			return nil, fmt.Errorf("decode pending config fields for %s: %w", change.Scope, err)
		}
		changes = append(changes, change)
	}
	return changes, rows.Err()
}

func (s *Store) DeletePendingConfigChange(scope string) error {
	_, err := s.db.Exec(`DELETE FROM pending_config_changes WHERE scope=?`, scope)
	return err
}

func (s *Store) DeletePendingConfigChanges(scopes ...string) error {
	if len(scopes) == 0 {
		return nil
	}
	args := make([]any, len(scopes))
	placeholders := make([]string, len(scopes))
	for i, scope := range scopes {
		args[i] = scope
		placeholders[i] = "?"
	}
	_, err := s.db.Exec(`DELETE FROM pending_config_changes WHERE scope IN (`+joinComma(placeholders)+`)`, args...)
	return err
}

func (s *Store) initializeAppliedConfigSettings() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM applied_config_settings`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return tx.Commit()
	}
	for _, key := range configSettingKeys() {
		value := configSettingDefault(key)
		var saved string
		err := tx.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&saved)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if err == nil {
			value = saved
		}
		if _, err := tx.Exec(`INSERT INTO applied_config_settings(key,value) VALUES(?,?)`, key, value); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func pendingFieldsForScope(tx *sql.Tx, scope string) ([]string, error) {
	keys, ok := configScopeSettings[scope]
	if !ok {
		return nil, fmt.Errorf("unknown config scope %q", scope)
	}
	fields := make([]string, 0, len(keys))
	for _, key := range keys {
		current, err := txSettingValue(tx, "settings", key, configSettingDefault(key))
		if err != nil {
			return nil, err
		}
		applied, err := txSettingValue(tx, "applied_config_settings", key, configSettingDefault(key))
		if err != nil {
			return nil, err
		}
		if current != applied {
			fields = append(fields, key)
		}
	}
	return fields, nil
}

func txSettingValue(tx *sql.Tx, table, key, def string) (string, error) {
	var value string
	err := tx.QueryRow(`SELECT value FROM `+table+` WHERE key=?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return def, nil
	}
	return value, err
}

func configSettingKeys() []string {
	keys := make([]string, 0, len(configSettingDefaults)+1)
	for _, scope := range ConfigScopes() {
		keys = append(keys, configScopeSettings[scope]...)
	}
	return keys
}

func configSettingDefault(key string) string {
	if value, ok := configSettingDefaults[key]; ok {
		return value
	}
	if key != "geox_urls" {
		return ""
	}
	files := map[string]string{
		"geoip":        "geoip.dat",
		"geoip.metadb": "geoip.metadb",
		"geosite":      "geosite.dat",
		"mmdb":         "country.mmdb",
		"asn":          "GeoLite2-ASN.mmdb",
	}
	sources := make(map[string][]string, len(files))
	for kind, file := range files {
		sources[kind] = []string{
			"https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/" + file,
			"https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/" + file,
			"https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/" + file,
		}
	}
	encoded, _ := json.Marshal(sources)
	return string(encoded)
}

func pendingConfigTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func dedupeAndSort(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value != "" {
			seen[value] = struct{}{}
		}
	}
	out := make([]string, 0, len(seen))
	for value := range seen {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
