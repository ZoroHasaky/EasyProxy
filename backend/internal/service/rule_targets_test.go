package service

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func testNode(id int64, name, hash, region string, enabled bool) model.Node {
	return model.Node{
		ID: id, Name: name, Type: "ss", Server: "127.0.0.1", Port: 10000 + int(id),
		Region: region, SourceType: "manual", RawConfig: map[string]any{
			"type": "ss", "server": "127.0.0.1", "port": 10000 + int(id),
			"cipher": "aes-128-gcm", "password": "test",
		}, DedupHash: hash, Enabled: enabled,
	}
}

func TestRuleTargetResolverStableRefsAndFallbacks(t *testing.T) {
	nodes := []model.Node{testNode(1, "香港节点", "hash-1", "HK", true)}
	groups := []model.Group{
		{ID: 10, Name: "🇭🇰 香港", Region: "HK", Enabled: true},
		{ID: 11, Name: "🇺🇸 美国", Region: "US", Enabled: true},
		{ID: 12, Name: "已禁用", Enabled: false},
	}
	r := newRuleTargetResolver(nodes, groups)
	tests := map[string]string{
		model.NodeTargetRef(1):   "香港节点",
		model.NodeTargetRef(99):  GroupPROXY,
		model.GroupTargetRef(10): "🇭🇰 香港",
		model.GroupTargetRef(11): GroupPROXY,
		model.GroupTargetRef(12): GroupPROXY,
		"🇭🇰 香港":                  "🇭🇰 香港",
		"香港节点":                   "香港节点",
		"DIRECT":                 "DIRECT",
		"missing":                GroupPROXY,
	}
	for target, want := range tests {
		if got := r.resolve(target); got != want {
			t.Errorf("resolve(%q) = %q, want %q", target, got, want)
		}
	}

	nodes[0].Name = "香港节点（新名称）"
	if got := newRuleTargetResolver(nodes, groups).resolve(model.NodeTargetRef(1)); got != nodes[0].Name {
		t.Fatalf("renamed node resolved to %q, want %q", got, nodes[0].Name)
	}
}

func TestApplyTemplateRulesPreservesTargetOverride(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	tpl := &model.Template{
		Name: "test", Source: "paste", Mapping: map[string]string{},
		Content: "rules:\n  - DOMAIN-SUFFIX,example.com,PROXY\n  - DOMAIN-SUFFIX,plain.example,PROXY\n",
	}
	if err := st.CreateTemplate(tpl); err != nil {
		t.Fatal(err)
	}
	if err := ApplyTemplateRules(st, tpl); err != nil {
		t.Fatal(err)
	}
	rules, _ := st.ListRules(tpl.ID)
	rules[0].Target = model.NodeTargetRef(42)
	rules[0].TargetOverride = true
	if err := st.ReplaceRules(tpl.ID, rules, nil); err != nil {
		t.Fatal(err)
	}

	tpl.Content = "rules:\n  - DOMAIN-SUFFIX,example.com,DIRECT\n  - DOMAIN-SUFFIX,plain.example,DIRECT\n"
	if err := ApplyTemplateRules(st, tpl); err != nil {
		t.Fatal(err)
	}
	rules, _ = st.ListRules(tpl.ID)
	if rules[0].Target != model.NodeTargetRef(42) || rules[0].BaseTarget != "DIRECT" || !rules[0].TargetOverride {
		t.Fatalf("override not preserved: %#v", rules[0])
	}
	if rules[1].Target != "DIRECT" || rules[1].BaseTarget != "DIRECT" || rules[1].TargetOverride {
		t.Fatalf("plain rule did not follow template: %#v", rules[1])
	}
}

func TestGenerateConfigResolvesNodeTarget(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	node := testNode(0, "指定节点", "hash-config", "HK", true)
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	tpl := &model.Template{Name: "test", Source: "paste", Content: "rules:\n  - MATCH,PROXY\n", Mapping: map[string]string{}}
	if err := st.CreateTemplate(tpl); err != nil {
		t.Fatal(err)
	}
	rules := []model.Rule{{Kind: "DOMAIN-SUFFIX", Value: "example.com", Target: model.NodeTargetRef(node.ID), BaseTarget: "PROXY", TargetOverride: true, Enabled: true}, {Kind: "MATCH", Target: "PROXY", BaseTarget: "PROXY", Enabled: true}}
	if err := st.ReplaceRules(tpl.ID, rules, nil); err != nil {
		t.Fatal(err)
	}
	gen, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gen.YAML, `DOMAIN-SUFFIX,example.com,指定节点`) {
		t.Fatalf("node target was not resolved:\n%s", gen.YAML)
	}
	if strings.Contains(gen.YAML, "@easyproxy/node/") {
		t.Fatalf("internal target reference leaked into YAML:\n%s", gen.YAML)
	}
}

func TestRuleTargetOptionsExcludeDedupedNodesAndMarkEmptyGroups(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	first := testNode(0, "香港一", "same-hash", "HK", true)
	second := testNode(0, "香港二", "same-hash", "HK", true)
	if err := st.CreateNode(&first); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateNode(&second); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceGroups([]model.Group{{Name: "香港组", Region: "HK", Enabled: true}, {Name: "美国组", Region: "US", Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	options, err := ListRuleTargetOptions(st)
	if err != nil {
		t.Fatal(err)
	}
	nodeCount := 0
	groups := map[string]model.RuleTargetOption{}
	for _, option := range options {
		if option.Kind == "node" {
			nodeCount++
		} else {
			groups[option.Name] = option
		}
	}
	if nodeCount != 1 {
		t.Fatalf("node option count = %d, want 1", nodeCount)
	}
	if !groups["香港组"].Available || groups["香港组"].MemberCount != 1 {
		t.Fatalf("香港组 option = %#v", groups["香港组"])
	}
	if groups["美国组"].Available || groups["美国组"].MemberCount != 0 {
		t.Fatalf("美国组 option = %#v", groups["美国组"])
	}
}
