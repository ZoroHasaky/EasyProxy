package store

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
)

func TestGroupChainUpstreamPersistsAndRenamePropagates(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := st.ReplaceGroups([]model.Group{{
		Name: "香港链式", Enabled: true, ChainUpstream: model.NodeChainUpstream("JP-01"),
	}}); err != nil {
		t.Fatal(err)
	}
	groups, err := st.ListGroups()
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 || groups[0].ChainUpstream != "node:JP-01" {
		t.Fatalf("chain_upstream not persisted: %#v", groups)
	}

	if err := st.RenameChainUpstreamNode("JP-01", "JP-02"); err != nil {
		t.Fatal(err)
	}
	groups, _ = st.ListGroups()
	if groups[0].ChainUpstream != "node:JP-02" {
		t.Fatalf("rename not propagated: %q", groups[0].ChainUpstream)
	}

	// 不相关的节点改名不应影响引用。
	if err := st.RenameChainUpstreamNode("US-01", "US-02"); err != nil {
		t.Fatal(err)
	}
	groups, _ = st.ListGroups()
	if groups[0].ChainUpstream != "node:JP-02" {
		t.Fatalf("unrelated rename changed reference: %q", groups[0].ChainUpstream)
	}
}

func TestReplaceGroupsRejectsDeletingChainUpstream(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := st.ReplaceGroups([]model.Group{
		{Name: "前置组", Enabled: true},
		{Name: "落地组", Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	groups, _ := st.ListGroups()
	upstreamID := groups[0].ID

	groups[1].ChainUpstream = model.GroupChainUpstream(upstreamID)
	if err := st.ReplaceGroups(groups); err != nil {
		t.Fatal(err)
	}

	// 只保留落地组，前置组应因被链式引用而被拒绝删除。
	if err := st.ReplaceGroups([]model.Group{groups[1]}); err == nil {
		t.Fatal("expected deletion of referenced chain upstream to fail")
	} else if !strings.Contains(err.Error(), "链式代理引用") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestReplaceGroupsRemapsNegativeChainUpstream(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	// 模拟前端一次保存里新建的两个组合：A 是前置，B 以 A 的临时负数 ID 为前置。
	const tempUpstreamID int64 = -1700000000000
	if err := st.ReplaceGroups([]model.Group{
		{ID: tempUpstreamID, Name: "前置组", Enabled: true},
		{ID: tempUpstreamID - 1, Name: "落地组", Enabled: true,
			ChainUpstream: model.GroupChainUpstream(tempUpstreamID)},
	}); err != nil {
		t.Fatal(err)
	}

	groups, err := st.ListGroups()
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]model.Group{}
	for _, g := range groups {
		byName[g.Name] = g
	}
	upstream := byName["前置组"]
	landing := byName["落地组"]
	if upstream.ID <= 0 || landing.ID <= 0 {
		t.Fatalf("groups should have real IDs: %#v", groups)
	}
	want := model.GroupChainUpstream(upstream.ID)
	if landing.ChainUpstream != want {
		t.Fatalf("chain_upstream = %q; want %q (temporary ID must be remapped)", landing.ChainUpstream, want)
	}
	if strings.Contains(landing.ChainUpstream, "-") {
		t.Fatalf("chain_upstream still contains a negative temp ID: %q", landing.ChainUpstream)
	}
}

func TestGroupChainUpstreamColumnMigratesExistingDatabase(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(`DROP TABLE proxy_groups`); err != nil {
		t.Fatal(err)
	}
	// 重建旧版 schema（无 chain_upstream），验证迁移会补列。
	if _, err := st.db.Exec(`CREATE TABLE proxy_groups (
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
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(`INSERT INTO proxy_groups(name,enabled) VALUES('旧组合',1)`); err != nil {
		t.Fatal(err)
	}
	st.Close()

	reopened, err := Open(dir)
	if err != nil {
		t.Fatalf("migration failed: %v", err)
	}
	defer reopened.Close()
	groups, err := reopened.ListGroups()
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 || groups[0].ChainUpstream != "" {
		t.Fatalf("migrated groups = %#v", groups)
	}
	if err := reopened.ReplaceGroups([]model.Group{{
		ID: groups[0].ID, Name: "旧组合", Enabled: true, ChainUpstream: model.NodeChainUpstream("JP-01"),
	}}); err != nil {
		t.Fatalf("write after migration failed: %v", err)
	}
}
