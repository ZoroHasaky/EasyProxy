package store

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"

	_ "modernc.org/sqlite"
)

func TestAppliedConfigSettingsInitializeFromExistingSettings(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", "file:"+filepath.ToSlash(filepath.Join(dir, "state.db")))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO settings(key,value) VALUES('mixed_port','18080'),('tun_enable','1')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	applied, err := st.AppliedConfigSettings()
	if err != nil {
		t.Fatal(err)
	}
	if applied["mixed_port"] != "18080" || applied["tun_enable"] != "1" {
		t.Fatalf("snapshot did not retain existing settings: %#v", applied)
	}
	if applied["log_level"] != "info" || applied["dns_enable"] != "1" || applied["geo_auto_update"] != "1" {
		t.Fatalf("snapshot did not initialize default settings: %#v", applied)
	}
}

func TestUpdateConfigSettingsAndSyncPendingPersistsAndRollsBack(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	changes, err := st.UpdateConfigSettingsAndSyncPending(map[string]string{
		"mixed_port": "18080",
		"log_level":  "debug",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || changes[0].Scope != ConfigScopeKernelNetwork ||
		!reflect.DeepEqual(changes[0].Fields, []string{"mixed_port", "log_level"}) ||
		changes[0].Status != PendingConfigStatusPending || changes[0].UpdatedAt == "" {
		t.Fatalf("unexpected pending changes: %#v", changes)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	st, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	changes, err = st.ListPendingConfigChanges()
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || !reflect.DeepEqual(changes[0].Fields, []string{"mixed_port", "log_level"}) {
		t.Fatalf("pending changes did not survive restart: %#v", changes)
	}

	changes, err = st.UpdateConfigSettingsAndSyncPending(map[string]string{"mixed_port": "7890"})
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || !reflect.DeepEqual(changes[0].Fields, []string{"log_level"}) {
		t.Fatalf("field rollback did not update pending fields: %#v", changes)
	}
	changes, err = st.UpdateConfigSettingsAndSyncPending(map[string]string{"log_level": "info"})
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 0 {
		t.Fatalf("full rollback should clear pending scope: %#v", changes)
	}
}

func TestPendingConfigChangeUpsertAndDelete(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.UpsertPendingConfigChange(PendingConfigChange{
		Scope:     "nodes",
		Fields:    []string{"node_pool", "node_pool"},
		Status:    PendingConfigStatusFailed,
		LastError: "热重载失败",
	}); err != nil {
		t.Fatal(err)
	}
	changes, err := st.ListPendingConfigChanges()
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || !reflect.DeepEqual(changes[0].Fields, []string{"node_pool"}) || changes[0].LastError != "热重载失败" {
		t.Fatalf("unexpected upserted change: %#v", changes)
	}
	if err := st.DeletePendingConfigChange("nodes"); err != nil {
		t.Fatal(err)
	}
	changes, err = st.ListPendingConfigChanges()
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 0 {
		t.Fatalf("delete did not remove pending change: %#v", changes)
	}
}

func TestAppliedConfigYAMLPersistsAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SaveAppliedConfigYAML("mixed-port: 7890\n"); err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	st, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if yaml, err := st.AppliedConfigYAML(); err != nil || yaml != "mixed-port: 7890\n" {
		t.Fatalf("persisted YAML=%q err=%v", yaml, err)
	}
}
