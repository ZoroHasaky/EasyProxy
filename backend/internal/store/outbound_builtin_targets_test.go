package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	"easyproxy/internal/model"
)

func TestOutboundRulesAcceptBuiltinTargets(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{{
		Name: "测试规则", Kind: "DOMAIN-SUFFIX", Conditions: []string{"example.com"}, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	rules, _ := st.ListRecognitionRules()
	if err := st.ReplaceOutboundRules([]model.OutboundRule{{
		RecognitionID: rules[0].ID, GroupID: model.OutboundTargetRejectID, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	outbounds, err := st.ListOutboundRules()
	if err != nil || len(outbounds) != 1 || outbounds[0].GroupID != model.OutboundTargetRejectID {
		t.Fatalf("outbounds=%#v err=%v", outbounds, err)
	}
	if err := st.ReplaceOutboundRules([]model.OutboundRule{{
		RecognitionID: rules[0].ID, GroupID: -99, Enabled: true,
	}}); err == nil {
		t.Fatal("unknown builtin target should be rejected")
	}
}

func TestOpenMigratesOutboundRulesForBuiltinTargets(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.ToSlash(filepath.Join(dir, "state.db"))
	db, err := sql.Open("sqlite", "file:"+dbPath+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE TABLE proxy_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)`,
		`CREATE TABLE recognition_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, conditions TEXT NOT NULL DEFAULT '[]', priority INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1)`,
		`CREATE TABLE outbound_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, recognition_id INTEGER NOT NULL UNIQUE, group_id INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(recognition_id) REFERENCES recognition_rules(id), FOREIGN KEY(group_id) REFERENCES proxy_groups(id))`,
		`INSERT INTO proxy_groups(id,name) VALUES(1,'旧节点组合')`,
		`INSERT INTO recognition_rules(id,name,kind,conditions,priority,enabled) VALUES(1,'旧规则','DOMAIN-SUFFIX','["example.com"]',0,1)`,
		`INSERT INTO outbound_rules(id,recognition_id,group_id,enabled) VALUES(1,1,1,1)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			db.Close()
			t.Fatal(err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	outbounds, err := st.ListOutboundRules()
	if err != nil || len(outbounds) != 1 || outbounds[0].GroupID != 1 {
		t.Fatalf("legacy outbound mapping was not preserved: %#v err=%v", outbounds, err)
	}
	if err := st.ReplaceOutboundRules([]model.OutboundRule{{
		ID: outbounds[0].ID, RecognitionID: outbounds[0].RecognitionID, GroupID: model.OutboundTargetAutoID, Enabled: true,
	}}); err != nil {
		t.Fatalf("builtin target should be accepted after migration: %v", err)
	}
}
