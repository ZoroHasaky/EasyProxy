package service

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"

	"gopkg.in/yaml.v3"
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

func TestGenerateConfigRoutesRecognitionRuleToSelectedGroup(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	node := testNode(0, "指定节点", "hash-config", "HK", true)
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceGroups([]model.Group{{
		Name: "指定策略组", Type: "select", MemberMode: "manual", NodeIDs: []int64{node.ID}, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	groups, _ := st.ListGroups()
	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{{
		Name: "示例站点", Kind: "DOMAIN-SUFFIX", Conditions: []string{"example.com"}, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	recognitions, _ := st.ListRecognitionRules()
	if err := st.ReplaceOutboundRules([]model.OutboundRule{{
		RecognitionID: recognitions[0].ID, GroupID: groups[0].ID, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	gen, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gen.YAML, `DOMAIN-SUFFIX,example.com,指定策略组`) {
		t.Fatalf("recognition rule was not mapped to its group:\n%s", gen.YAML)
	}
	if !strings.Contains(gen.YAML, "- 指定节点") {
		t.Fatalf("manual node selection was not written to the group:\n%s", gen.YAML)
	}
}

func TestGenerateConfigRoutesRecognitionRulesToBuiltinOutboundTargets(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	node := testNode(0, "自动测速节点", "hash-builtin-target", "HK", true)
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{
		{Name: "直连规则", Kind: "DOMAIN-SUFFIX", Conditions: []string{"direct.example"}, Priority: 3, Enabled: true},
		{Name: "拒绝规则", Kind: "DOMAIN-SUFFIX", Conditions: []string{"reject.example"}, Priority: 2, Enabled: true},
		{Name: "自动规则", Kind: "DOMAIN-SUFFIX", Conditions: []string{"auto.example"}, Priority: 1, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	recognitions, _ := st.ListRecognitionRules()
	ids := map[string]int64{}
	for _, recognition := range recognitions {
		ids[recognition.Name] = recognition.ID
	}
	if err := st.ReplaceOutboundRules([]model.OutboundRule{
		{RecognitionID: ids["直连规则"], GroupID: model.OutboundTargetDirectID, Enabled: true},
		{RecognitionID: ids["拒绝规则"], GroupID: model.OutboundTargetRejectID, Enabled: true},
		{RecognitionID: ids["自动规则"], GroupID: model.OutboundTargetAutoID, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	gen, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"DOMAIN-SUFFIX,direct.example,DIRECT",
		"DOMAIN-SUFFIX,reject.example,REJECT",
		"DOMAIN-SUFFIX,auto.example,AUTO",
	} {
		if !strings.Contains(gen.YAML, expected) {
			t.Fatalf("missing builtin outbound route %q:\n%s", expected, gen.YAML)
		}
	}
}

func TestGenerateConfigWritesYAMLRuleProvidersBeforeRuleSets(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	node := testNode(0, "规则节点", "hash-yaml-provider", "HK", true)
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceGroups([]model.Group{{
		Name: "规则组", Type: "select", MemberMode: "manual", NodeIDs: []int64{node.ID}, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	created, err := st.CreateRecognitionRules([]model.RecognitionRule{
		{Name: "apple", SourceURL: "https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/apple.yaml", SourceBehavior: "domain", SourceInterval: 7200, Priority: 20, Enabled: true},
		{Name: "private-ip", SourceURL: "https://example.com/private.yaml", SourceBehavior: "ipcidr", SourceInterval: 86400, Priority: 10, Enabled: true},
		{Name: "classical", SourceURL: "https://example.com/classical.yaml", SourceBehavior: "classical", SourceInterval: 86400, Priority: 5, Enabled: true},
		{Name: "match", Kind: "MATCH", Priority: 0, Enabled: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	groups, _ := st.ListGroups()
	outbounds := make([]model.OutboundRule, 0, len(created))
	for _, recognition := range created {
		outbounds = append(outbounds, model.OutboundRule{RecognitionID: recognition.ID, GroupID: groups[0].ID, Enabled: true})
	}
	if err := st.ReplaceOutboundRules(outbounds); err != nil {
		t.Fatal(err)
	}

	gen, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := yaml.Unmarshal([]byte(gen.YAML), &parsed); err != nil {
		t.Fatalf("generated YAML is invalid: %v\n%s", err, gen.YAML)
	}
	providers, ok := parsed["rule-providers"].(map[string]any)
	if !ok || len(providers) != 3 {
		t.Fatalf("rule providers=%#v\n%s", parsed["rule-providers"], gen.YAML)
	}
	apple, ok := providers["apple"].(map[string]any)
	if !ok || apple["format"] != "yaml" || apple["interval"] != 7200 || apple["url"] != "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/apple.yaml" {
		t.Fatalf("apple provider=%#v", apple)
	}
	if !strings.Contains(gen.YAML, "RULE-SET,private-ip,规则组,no-resolve") || !strings.Contains(gen.YAML, "RULE-SET,classical,规则组") {
		t.Fatalf("RULE-SET routes missing:\n%s", gen.YAML)
	}
	if strings.Index(gen.YAML, "RULE-SET,apple") > strings.Index(gen.YAML, "RULE-SET,private-ip") || strings.Index(gen.YAML, "RULE-SET,apple") > strings.Index(gen.YAML, "MATCH,规则组") {
		t.Fatalf("remote rules were not ordered by priority:\n%s", gen.YAML)
	}
}

func TestGenerateConfigDoesNotInjectGeoIPRule(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	node := testNode(0, "测试节点", "hash-no-geoip", "HK", true)
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	gen, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(gen.YAML, "GEOIP,CN,DIRECT") {
		t.Fatalf("unexpected implicit GeoIP rule:\n%s", gen.YAML)
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
