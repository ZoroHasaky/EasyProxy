package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

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
			FOREIGN KEY(recognition_id) REFERENCES recognition_rules(id),
			FOREIGN KEY(group_id) REFERENCES proxy_groups(id)
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
	if err := s.migrateRuleTargetRefs(); err != nil {
		return fmt.Errorf("migrate target refs: %w", err)
	}
	if err := s.migrateCurrentRuleSet(); err != nil {
		return fmt.Errorf("migrate current rules: %w", err)
	}
	if err := s.initializeAppliedConfigSettings(); err != nil {
		return fmt.Errorf("initialize applied config settings: %w", err)
	}
	if err := s.PruneAuditLogs(time.Now().Add(-AuditLogRetention)); err != nil {
		return fmt.Errorf("prune audit logs: %w", err)
	}
	return nil
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
