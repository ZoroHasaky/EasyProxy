package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"easyproxy/internal/model"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	dsn := "file:" + filepath.ToSlash(filepath.Join(dir, "state.db")) +
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// WAL 支持多读单写：多连接避免个别连接异常不归还时拖死整个面板（写冲突由 busy_timeout 串行化）
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(8)
	db.SetConnMaxIdleTime(5 * time.Minute)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// Stats 暴露连接池状态，供饱和告警使用
func (s *Store) Stats() sql.DBStats { return s.db.Stats() }

func (s *Store) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS subscriptions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			user_agent TEXT NOT NULL DEFAULT '',
			update_interval INTEGER NOT NULL DEFAULT 0,
			via_proxy INTEGER NOT NULL DEFAULT 0,
			enabled INTEGER NOT NULL DEFAULT 1,
			last_update TEXT NOT NULL DEFAULT '',
			node_count INTEGER NOT NULL DEFAULT 0,
			user_info TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS nodes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			type TEXT NOT NULL DEFAULT '',
			server TEXT NOT NULL DEFAULT '',
			port INTEGER NOT NULL DEFAULT 0,
			region TEXT NOT NULL DEFAULT 'OTHER',
			source_type TEXT NOT NULL DEFAULT 'manual',
			source_id INTEGER NOT NULL DEFAULT 0,
			raw_config TEXT NOT NULL DEFAULT '{}',
			dedup_hash TEXT NOT NULL DEFAULT '',
			enabled INTEGER NOT NULL DEFAULT 1,
			latency INTEGER NOT NULL DEFAULT 0,
			latency_at TEXT NOT NULL DEFAULT '',
			alive INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_nodes_source ON nodes(source_type, source_id)`,
		`CREATE INDEX IF NOT EXISTS idx_nodes_hash ON nodes(dedup_hash)`,
		`CREATE TABLE IF NOT EXISTS templates (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'paste',
			url TEXT NOT NULL DEFAULT '',
			content TEXT NOT NULL DEFAULT '',
			mapping TEXT NOT NULL DEFAULT '{}',
			updated_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS rules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			template_id INTEGER NOT NULL,
			kind TEXT NOT NULL,
			value TEXT NOT NULL DEFAULT '',
			target TEXT NOT NULL,
			no_resolve INTEGER NOT NULL DEFAULT 0,
			position INTEGER NOT NULL DEFAULT 0,
			enabled INTEGER NOT NULL DEFAULT 1
		)`,
		`CREATE INDEX IF NOT EXISTS idx_rules_tpl ON rules(template_id, position)`,
		`CREATE TABLE IF NOT EXISTS rule_providers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			template_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			url TEXT NOT NULL DEFAULT '',
			behavior TEXT NOT NULL DEFAULT 'domain',
			format TEXT NOT NULL DEFAULT 'yaml',
			interval INTEGER NOT NULL DEFAULT 86400
		)`,
		`CREATE TABLE IF NOT EXISTS proxy_groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			type TEXT NOT NULL DEFAULT 'select',
			member_mode TEXT NOT NULL DEFAULT '',
			node_ids TEXT NOT NULL DEFAULT '[]',
			region TEXT NOT NULL DEFAULT '',
			include_regex TEXT NOT NULL DEFAULT '',
			test_url TEXT NOT NULL DEFAULT '',
			interval INTEGER NOT NULL DEFAULT 300,
			tolerance INTEGER NOT NULL DEFAULT 50,
			icon TEXT NOT NULL DEFAULT '',
			position INTEGER NOT NULL DEFAULT 0,
			enabled INTEGER NOT NULL DEFAULT 1
		)`,
		`CREATE TABLE IF NOT EXISTS recognition_rules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			kind TEXT NOT NULL,
			conditions TEXT NOT NULL DEFAULT '[]',
			priority INTEGER NOT NULL DEFAULT 0,
			enabled INTEGER NOT NULL DEFAULT 1
		)`,
		`CREATE TABLE IF NOT EXISTS outbound_rules (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			recognition_id INTEGER NOT NULL UNIQUE,
			group_id INTEGER NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			FOREIGN KEY(recognition_id) REFERENCES recognition_rules(id)
		)`,
		`CREATE TABLE IF NOT EXISTS applied_config_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS pending_config_changes (
			scope TEXT PRIMARY KEY,
			fields TEXT NOT NULL DEFAULT '[]',
			status TEXT NOT NULL DEFAULT 'pending',
			last_error TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS applied_config_state (
			id INTEGER PRIMARY KEY CHECK (id=1),
			yaml TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			created_at TEXT NOT NULL,
			category TEXT NOT NULL,
			level TEXT NOT NULL DEFAULT 'info',
			event TEXT NOT NULL DEFAULT '',
			summary TEXT NOT NULL,
			details TEXT NOT NULL DEFAULT '{}',
			source_key TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category, created_at DESC, id DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_source ON audit_logs(source_key) WHERE source_key != ''`,
	}
	for _, q := range stmts {
		if _, err := s.db.Exec(q); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	if err := s.ensureColumn("rules", "base_target", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := s.ensureColumn("rules", "target_override", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := s.ensureColumn("proxy_groups", "member_mode", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := s.ensureColumn("proxy_groups", "node_ids", "TEXT NOT NULL DEFAULT '[]'"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := s.ensureColumn("recognition_rules", "source_url", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := s.ensureColumn("recognition_rules", "source_behavior", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := s.ensureColumn("recognition_rules", "source_interval", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	if err := s.migrateOutboundRulesBuiltinTargets(); err != nil {
		return fmt.Errorf("migrate outbound builtin targets: %w", err)
	}
	if err := s.migrateRuleTargetRefs(); err != nil {
		return fmt.Errorf("migrate target refs: %w", err)
	}
	if err := s.migrateCurrentRuleSet(); err != nil {
		return fmt.Errorf("migrate current rules: %w", err)
	}
	if err := s.removeMRSRuleProviders(); err != nil {
		return fmt.Errorf("remove MRS rule providers: %w", err)
	}
	if err := s.normalizeGitHubRuleProviderURLs(); err != nil {
		return fmt.Errorf("normalize GitHub rule provider URLs: %w", err)
	}
	if err := s.removeImplicitGeoIPRuleFromAppliedConfig(); err != nil {
		return fmt.Errorf("remove implicit GeoIP rule from applied config: %w", err)
	}
	if err := s.initializeAppliedConfigSettings(); err != nil {
		return fmt.Errorf("initialize applied config settings: %w", err)
	}
	if err := s.PruneAuditLogs(time.Now().Add(-AuditLogRetention)); err != nil {
		return fmt.Errorf("prune audit logs: %w", err)
	}
	return nil
}

// migrateOutboundRulesBuiltinTargets 移除旧表对 proxy_groups 的外键约束，使
// group_id 能保存内置出站目标的负数 ID；识别规则的外键约束仍然保留。
func (s *Store) migrateOutboundRulesBuiltinTargets() error {
	rows, err := s.db.Query(`PRAGMA foreign_key_list(outbound_rules)`)
	if err != nil {
		return err
	}
	hasGroupForeignKey := false
	for rows.Next() {
		var id, sequence int
		var table, from, to, onUpdate, onDelete, match string
		if err := rows.Scan(&id, &sequence, &table, &from, &to, &onUpdate, &onDelete, &match); err != nil {
			return err
		}
		if table == "proxy_groups" && from == "group_id" {
			hasGroupForeignKey = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if !hasGroupForeignKey {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE TABLE outbound_rules_next (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recognition_id INTEGER NOT NULL UNIQUE,
		group_id INTEGER NOT NULL,
		enabled INTEGER NOT NULL DEFAULT 1,
		FOREIGN KEY(recognition_id) REFERENCES recognition_rules(id)
	)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO outbound_rules_next(id,recognition_id,group_id,enabled)
		SELECT id,recognition_id,group_id,enabled FROM outbound_rules`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DROP TABLE outbound_rules`); err != nil {
		return err
	}
	if _, err := tx.Exec(`ALTER TABLE outbound_rules_next RENAME TO outbound_rules`); err != nil {
		return err
	}
	return tx.Commit()
}

// removeImplicitGeoIPRuleFromAppliedConfig 清理旧版本在无显式规则时插入的
// GEOIP,CN,DIRECT。规则快照清空后会按当前规则表重新生成，手动配置的 GeoIP
// 识别规则不会丢失。
func (s *Store) removeImplicitGeoIPRuleFromAppliedConfig() error {
	var yaml string
	err := s.db.QueryRow(`SELECT yaml FROM applied_config_state WHERE id=1`).Scan(&yaml)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if !strings.Contains(yaml, "GEOIP,CN,DIRECT") {
		return nil
	}
	_, err = s.db.Exec(`DELETE FROM applied_config_state WHERE id=1`)
	return err
}

// normalizeGitHubRuleProviderURLs 修复历史记录中误填的 GitHub blob 浏览地址。
// Mihomo 需要下载原始 YAML；地址变更后清空已应用 YAML，确保下次启动重新生成配置。
func (s *Store) normalizeGitHubRuleProviderURLs() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`SELECT id,source_url FROM recognition_rules WHERE trim(source_url) != ''`)
	if err != nil {
		return err
	}
	type sourceRef struct {
		id  int64
		url string
	}
	var changed []sourceRef
	for rows.Next() {
		var item sourceRef
		if err := rows.Scan(&item.id, &item.url); err != nil {
			rows.Close()
			return err
		}
		normalized := model.NormalizeGitHubContentURL(item.url)
		if normalized != item.url {
			changed = append(changed, sourceRef{id: item.id, url: normalized})
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(changed) == 0 {
		return tx.Commit()
	}
	for _, item := range changed {
		if _, err := tx.Exec(`UPDATE recognition_rules SET source_url=? WHERE id=?`, item.url, item.id); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM applied_config_state WHERE id=1`); err != nil {
		return err
	}
	return tx.Commit()
}

// removeMRSRuleProviders 是一次幂等清理：MRS 已不再受支持，删除旧来源及其 RULE-SET 引用。
func (s *Store) removeMRSRuleProviders() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`SELECT id,template_id,name FROM rule_providers
		WHERE lower(trim(format))='mrs' OR instr(lower(url), '.mrs') > 0`)
	if err != nil {
		return err
	}
	type providerRef struct {
		id         int64
		templateID int64
		name       string
	}
	var providers []providerRef
	for rows.Next() {
		var provider providerRef
		if err := rows.Scan(&provider.id, &provider.templateID, &provider.name); err != nil {
			rows.Close()
			return err
		}
		providers = append(providers, provider)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	changed := len(providers) > 0
	for _, provider := range providers {
		if _, err := tx.Exec(`DELETE FROM rules WHERE template_id=? AND upper(kind)='RULE-SET' AND value=?`, provider.templateID, provider.name); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM rule_providers WHERE id=?`, provider.id); err != nil {
			return err
		}
	}

	// 防御性清理：若开发版数据库曾写入远程 MRS 识别规则，也一并移除其出站映射。
	result, err := tx.Exec(`DELETE FROM outbound_rules WHERE recognition_id IN (
		SELECT id FROM recognition_rules WHERE instr(lower(source_url), '.mrs') > 0
	)`)
	if err != nil {
		return err
	}
	if count, err := result.RowsAffected(); err == nil && count > 0 {
		changed = true
	}
	result, err = tx.Exec(`DELETE FROM recognition_rules WHERE instr(lower(source_url), '.mrs') > 0`)
	if err != nil {
		return err
	}
	if count, err := result.RowsAffected(); err == nil && count > 0 {
		changed = true
	}
	// 已应用 YAML 可能仍包含旧版生成的 MRS Provider。清空快照后，下一次启动或
	// 应用会从已应用设置和当前规则数据重新生成，避免已删除来源被继续加载。
	if changed {
		if _, err := tx.Exec(`DELETE FROM applied_config_state WHERE id=1`); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// migrateCurrentRuleSet 将旧版激活模板的规则复制为唯一的当前规则集。
// 旧模板及其原始规则保持不动，便于旧备份恢复和数据回溯。
func (s *Store) migrateCurrentRuleSet() error {
	if s.GetSettingBool("current_rules_migrated", false) {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var currentCount int
	if err := tx.QueryRow(`SELECT (SELECT COUNT(*) FROM rules WHERE template_id=0) +
		(SELECT COUNT(*) FROM rule_providers WHERE template_id=0)`).Scan(&currentCount); err != nil {
		return err
	}
	if currentCount == 0 {
		activeID := int64(s.GetSettingInt("active_template_id", 0))
		if activeID == 0 {
			_ = tx.QueryRow(`SELECT id FROM templates ORDER BY id LIMIT 1`).Scan(&activeID)
		}
		if activeID > 0 {
			if _, err := tx.Exec(`INSERT INTO rules(template_id,kind,value,target,base_target,target_override,no_resolve,position,enabled)
				SELECT 0,kind,value,target,base_target,target_override,no_resolve,position,enabled
				FROM rules WHERE template_id=? ORDER BY position,id`, activeID); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO rule_providers(template_id,name,url,behavior,format,interval)
				SELECT 0,name,url,behavior,format,interval FROM rule_providers WHERE template_id=? ORDER BY id`, activeID); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec(`INSERT INTO settings(key,value) VALUES('current_rules_migrated','1')
		ON CONFLICT(key) DO UPDATE SET value='1'`); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ensureColumn(table, column, definition string) error {
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if name == column {
			found = true
			break
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if found {
		return nil
	}
	_, err = s.db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + definition)
	return err
}

// ---------- settings ----------

func (s *Store) GetSetting(key, def string) string {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&v)
	if err != nil {
		return def
	}
	return v
}

func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO settings(key,value) VALUES(?,?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

func (s *Store) GetSettingInt(key string, def int) int {
	v := s.GetSetting(key, "")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func (s *Store) GetSettingBool(key string, def bool) bool {
	v := s.GetSetting(key, "")
	switch v {
	case "1", "true":
		return true
	case "0", "false":
		return false
	}
	return def
}

func (s *Store) SetSettingJSON(key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return s.SetSetting(key, string(b))
}

func (s *Store) GetSettingJSON(key string, out any) bool {
	v := s.GetSetting(key, "")
	if v == "" {
		return false
	}
	return json.Unmarshal([]byte(v), out) == nil
}

// ---------- backup ----------

func (s *Store) ExportAll() (map[string]any, error) {
	out := map[string]any{"settings": map[string]string{}}
	setRows, err := s.db.Query(`SELECT key,value FROM settings`)
	if err != nil {
		return nil, err
	}
	settings := map[string]string{}
	for setRows.Next() {
		var k, v string
		_ = setRows.Scan(&k, &v)
		settings[k] = v
	}
	setRows.Close()
	out["settings"] = settings

	for _, table := range []string{"subscriptions", "nodes", "templates", "rules", "rule_providers", "proxy_groups", "recognition_rules", "outbound_rules"} {
		rows, err := s.db.Query(`SELECT * FROM ` + table)
		if err != nil {
			return nil, err
		}
		cols, _ := rows.Columns()
		list := []map[string]any{}
		for rows.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			_ = rows.Scan(ptrs...)
			m := map[string]any{}
			for i, c := range cols {
				m[c] = vals[i]
			}
			list = append(list, m)
		}
		rows.Close()
		out[table] = list
	}
	return out, nil
}

// ImportAll 清空并恢复全部表数据（settings 里敏感项可选保留）
func (s *Store) ImportAll(data map[string]any, keepAuth bool) error {
	oldSettings := map[string]string{}
	if keepAuth {
		setRows, err := s.db.Query(`SELECT key,value FROM settings WHERE key IN ('password_hash','must_change_password')`)
		if err == nil {
			for setRows.Next() {
				var k, v string
				_ = setRows.Scan(&k, &v)
				oldSettings[k] = v
			}
			setRows.Close()
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, t := range []string{"outbound_rules", "recognition_rules", "rules", "rule_providers", "proxy_groups", "nodes", "subscriptions", "templates", "settings"} {
		if _, err := tx.Exec(`DELETE FROM ` + t); err != nil {
			return err
		}
	}
	insert := func(table string, rows []map[string]any) error {
		for _, r := range rows {
			cols := make([]string, 0, len(r))
			vals := make([]any, 0, len(r))
			for k, v := range r {
				cols = append(cols, k)
				vals = append(vals, v)
			}
			if len(cols) == 0 {
				continue
			}
			ph := ""
			for i := range cols {
				if i > 0 {
					ph += ","
				}
				ph += "?"
			}
			q := `INSERT INTO ` + table + `(` + joinComma(cols) + `) VALUES(` + ph + `)`
			if _, err := tx.Exec(q, vals...); err != nil {
				return fmt.Errorf("insert %s: %w", table, err)
			}
		}
		return nil
	}
	for _, t := range []string{"settings", "subscriptions", "nodes", "templates", "rules", "rule_providers", "proxy_groups", "recognition_rules", "outbound_rules"} {
		raw, ok := data[t].([]any)
		if !ok {
			continue
		}
		rows := make([]map[string]any, 0, len(raw))
		for _, item := range raw {
			if m, ok := item.(map[string]any); ok {
				rows = append(rows, m)
			}
		}
		if err := insert(t, rows); err != nil {
			return err
		}
	}
	if keepAuth {
		for k, v := range oldSettings {
			if _, err := tx.Exec(`INSERT INTO settings(key,value) VALUES(?,?)
				ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, v); err != nil {
				return err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return s.migrateCurrentRuleSet()
}

func joinComma(ss []string) string {
	out := ""
	for i, s := range ss {
		if i > 0 {
			out += ","
		}
		out += s
	}
	return out
}
