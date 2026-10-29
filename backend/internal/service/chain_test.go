package service

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func chainTestNode(id int64, name string) model.Node {
	return model.Node{
		ID: id, Name: name, Type: "ss", Server: "127.0.0.1", Port: 10000 + int(id),
		Region: "HK", SourceType: "manual", Enabled: true,
		RawConfig: map[string]any{
			"name": name, "type": "ss", "server": "127.0.0.1",
			"port": 10000 + int(id), "cipher": "aes-128-gcm", "password": "test",
		},
		DedupHash: "hash-" + name,
	}
}

func TestBuildChainPlanNodeUpstream(t *testing.T) {
	nodes := []model.Node{chainTestNode(1, "JP-01"), chainTestNode(2, "HK-01"), chainTestNode(3, "HK-02")}
	groups := []model.Group{{
		ID: 7, Name: "香港链式", Type: "url-test", MemberMode: "region", Region: "HK",
		Enabled: true, ChainUpstream: model.NodeChainUpstream("JP-01"),
	}}

	plan := BuildChainPlan(nodes, groups)
	if len(plan.Unavailable) != 0 {
		t.Fatalf("unexpected unavailable groups: %v", plan.Unavailable)
	}
	upstream, ok := plan.UpstreamByGroup[7]
	if !ok || upstream != "JP-01" {
		t.Fatalf("upstream = %q, ok = %v; want JP-01", upstream, ok)
	}
	members := plan.MembersByGroup[7]
	if len(members) != 2 {
		t.Fatalf("members = %v; want 2 clone entries", members)
	}
	if len(plan.Clones) != 2 {
		t.Fatalf("clones = %d; want 2", len(plan.Clones))
	}
	for _, clone := range plan.Clones {
		if clone["dialer-proxy"] != "JP-01" {
			t.Fatalf("clone %v missing dialer-proxy JP-01", clone["name"])
		}
		name, _ := clone["name"].(string)
		if !strings.HasPrefix(name, "香港链式 · ") {
			t.Fatalf("clone name = %q; want prefix 香港链式 · ", name)
		}
		if plan.CloneUpstream[name] != "JP-01" {
			t.Fatalf("CloneUpstream[%s] = %q; want JP-01", name, plan.CloneUpstream[name])
		}
	}
}

func TestBuildChainPlanUnavailableCases(t *testing.T) {
	nodes := []model.Node{chainTestNode(1, "JP-01"), chainTestNode(2, "HK-01")}
	base := model.Group{ID: 7, Name: "链式", Type: "select", MemberMode: "all", Enabled: true}

	cases := []struct {
		name   string
		group  model.Group
		groups []model.Group
		reason string
	}{
		{
			name:   "missing upstream node",
			group:  withUpstream(base, model.NodeChainUpstream("NOPE")),
			groups: nil,
			reason: "不存在",
		},
		{
			name:   "self reference",
			group:  withUpstream(base, model.GroupChainUpstream(7)),
			groups: nil,
			reason: "自身",
		},
		{
			name:  "upstream group already chained",
			group: withUpstream(base, model.GroupChainUpstream(8)),
			groups: []model.Group{{
				ID: 8, Name: "前置", Type: "select", MemberMode: "manual",
				NodeIDs: []int64{1}, Enabled: true, ChainUpstream: model.NodeChainUpstream("JP-01"),
			}},
			reason: "两跳",
		},
		{
			name:  "upstream group disabled",
			group: withUpstream(base, model.GroupChainUpstream(8)),
			groups: []model.Group{{
				ID: 8, Name: "前置", Type: "select", MemberMode: "manual",
				NodeIDs: []int64{1}, Enabled: false,
			}},
			reason: "未启用",
		},
		{
			name:  "upstream group empty",
			group: withUpstream(base, model.GroupChainUpstream(8)),
			groups: []model.Group{{
				ID: 8, Name: "前置", Type: "select", MemberMode: "manual",
				NodeIDs: []int64{}, Enabled: true,
			}},
			reason: "没有可用节点",
		},
		{
			name:   "invalid format",
			group:  withUpstream(base, "garbage"),
			groups: nil,
			reason: "格式无效",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			groups := append([]model.Group{tc.group}, tc.groups...)
			plan := BuildChainPlan(nodes, groups)
			reason, broken := plan.Unavailable[tc.group.ID]
			if !broken {
				t.Fatalf("group %d should be unavailable", tc.group.ID)
			}
			if !strings.Contains(reason, tc.reason) {
				t.Fatalf("reason = %q; want contains %q", reason, tc.reason)
			}
			if len(plan.Clones) != 0 {
				t.Fatalf("unavailable group must not emit clones, got %d", len(plan.Clones))
			}
		})
	}
}

func withUpstream(g model.Group, upstream string) model.Group {
	g.ChainUpstream = upstream
	return g
}

func TestBuildChainPlanGroupUpstream(t *testing.T) {
	nodes := []model.Node{chainTestNode(1, "JP-01"), chainTestNode(2, "HK-01")}
	groups := []model.Group{
		{ID: 8, Name: "前置组", Type: "select", MemberMode: "manual", NodeIDs: []int64{1}, Enabled: true},
		withUpstream(model.Group{ID: 10, Name: "落地组", Type: "select", MemberMode: "manual",
			NodeIDs: []int64{2}, Enabled: true}, model.GroupChainUpstream(8)),
	}
	plan := BuildChainPlan(nodes, groups)
	upstream, ok := plan.UpstreamByGroup[10]
	if !ok || upstream != "前置组" {
		t.Fatalf("upstream = %q ok=%v; want 前置组", upstream, ok)
	}
	if len(plan.MembersByGroup[10]) != 1 {
		t.Fatalf("members = %v; want 1", plan.MembersByGroup[10])
	}
}

func TestBuildChainPlanSkipsDuplicateLandingNode(t *testing.T) {
	// 落地节点同时是第一跳：同一台服务器自环，必须跳过而不是生成自引用链路。
	nodes := []model.Node{chainTestNode(1, "JP-01")}
	groups := []model.Group{withUpstream(model.Group{
		ID: 9, Name: "自环组", Type: "select", MemberMode: "manual",
		NodeIDs: []int64{1}, Enabled: true,
	}, model.NodeChainUpstream("JP-01"))}

	plan := BuildChainPlan(nodes, groups)
	if _, broken := plan.Unavailable[9]; !broken {
		t.Fatalf("expected unavailable, got %+v", plan.UpstreamByGroup)
	}
	if len(plan.Clones) != 0 {
		t.Fatalf("expected no clones, got %d", len(plan.Clones))
	}
}

func TestBuildChainPlanCloneNameCollision(t *testing.T) {
	nodes := []model.Node{chainTestNode(1, "JP-01"), chainTestNode(2, "HK-01")}
	// 已存在同名组合，克隆名必须避让。
	groups := []model.Group{
		{ID: 8, Name: "落地组 · HK-01", Type: "select", MemberMode: "manual", NodeIDs: []int64{2}, Enabled: true},
		withUpstream(model.Group{ID: 10, Name: "落地组", Type: "select", MemberMode: "manual",
			NodeIDs: []int64{2}, Enabled: true}, model.NodeChainUpstream("JP-01")),
	}
	plan := BuildChainPlan(nodes, groups)
	members := plan.MembersByGroup[10]
	if len(members) != 1 {
		t.Fatalf("members = %v", members)
	}
	if members[0] == "落地组 · HK-01" {
		t.Fatalf("clone name collided with existing group: %q", members[0])
	}
}

func TestGenerateConfigWritesChainClones(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	jp := chainTestNode(0, "JP-01")
	if err := st.CreateNode(&jp); err != nil {
		t.Fatal(err)
	}
	hk := chainTestNode(0, "HK-01")
	if err := st.CreateNode(&hk); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceGroups([]model.Group{{
		Name: "香港链式", Type: "select", MemberMode: "manual", NodeIDs: []int64{hk.ID},
		Enabled: true, ChainUpstream: model.NodeChainUpstream(jp.Name),
	}}); err != nil {
		t.Fatal(err)
	}

	gen, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gen.YAML, "dialer-proxy: JP-01") {
		t.Fatalf("generated config missing dialer-proxy:\n%s", gen.YAML)
	}
	if !strings.Contains(gen.YAML, "- 香港链式 · HK-01") {
		t.Fatalf("chain group should reference the clone node:\n%s", gen.YAML)
	}
}

func TestGenerateConfigOmitsBrokenChainGroupAndFallsBack(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	hk := chainTestNode(0, "HK-01")
	if err := st.CreateNode(&hk); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceGroups([]model.Group{{
		Name: "香港链式", Type: "select", MemberMode: "manual", NodeIDs: []int64{hk.ID},
		Enabled: true, ChainUpstream: model.NodeChainUpstream("已删除节点"),
	}}); err != nil {
		t.Fatal(err)
	}
	groups, err := st.ListGroups()
	if err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{{
		Name: "示例", Kind: "DOMAIN-SUFFIX", Conditions: []string{"example.com"}, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	recognitions, err := st.ListRecognitionRules()
	if err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceOutboundRules([]model.OutboundRule{{
		RecognitionID: recognitions[0].ID, GroupID: groups[0].ID, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}

	gen, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(gen.YAML, "香港链式") {
		t.Fatalf("broken chain group must not be written:\n%s", gen.YAML)
	}
	if !strings.Contains(gen.YAML, "DOMAIN-SUFFIX,example.com,PROXY") {
		t.Fatalf("rule should fall back to PROXY:\n%s", gen.YAML)
	}
	if strings.Contains(gen.YAML, "dialer-proxy") {
		t.Fatalf("no clones should be generated:\n%s", gen.YAML)
	}
}
