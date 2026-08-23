package store

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
)

func TestMigrateActiveTemplateToCurrentRulesWithoutDeletingLegacyData(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &model.Template{Name: "旧模板", Source: "paste", Content: "rules:\n  - RULE-SET,private,DIRECT\n", Mapping: map[string]string{}}
	if err := st.CreateTemplate(tpl); err != nil {
		t.Fatal(err)
	}
	rules := []model.Rule{{Kind: "RULE-SET", Value: "private", Target: "DIRECT", BaseTarget: "DIRECT", Enabled: true}}
	providers := []model.RuleProvider{{Name: "private", URL: "https://example.com/private.yaml", Behavior: "domain", Format: "yaml", Interval: 86400}}
	if err := st.ReplaceRules(tpl.ID, rules, providers); err != nil {
		t.Fatal(err)
	}
	if err := st.ActivateTemplate(tpl.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.SetSetting("current_rules_migrated", "0"); err != nil {
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
	currentRules, _ := st.ListCurrentRules()
	currentProviders, _ := st.ListCurrentRuleProviders()
	legacyRules, _ := st.ListRules(tpl.ID)
	if len(currentRules) != 1 || currentRules[0].Value != "private" || len(currentProviders) != 1 {
		t.Fatalf("current data not migrated: rules=%#v providers=%#v", currentRules, currentProviders)
	}
	if len(legacyRules) != 1 {
		t.Fatalf("legacy template rules were removed: %#v", legacyRules)
	}
}

func TestReplaceCurrentRulesPreservesProviderIDAndRenamesReferences(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	rules := []model.Rule{{Kind: "RULE-SET", Value: "old", Target: "PROXY", BaseTarget: "PROXY", Enabled: true}}
	providers := []model.RuleProvider{{Name: "old", URL: "https://example.com/rules.yaml", Behavior: "domain", Format: "yaml", Interval: 86400}}
	if err := st.ReplaceCurrentRules(rules, providers); err != nil {
		t.Fatal(err)
	}
	before, _ := st.ListCurrentRuleProviders()
	if len(before) != 1 {
		t.Fatalf("providers=%#v", before)
	}
	before[0].Name = "new"
	if err := st.ReplaceCurrentRules(rules, before); err != nil {
		t.Fatal(err)
	}
	after, _ := st.ListCurrentRuleProviders()
	afterRules, _ := st.ListCurrentRules()
	if after[0].ID != before[0].ID || after[0].Name != "new" {
		t.Fatalf("provider ID was not preserved: before=%#v after=%#v", before[0], after[0])
	}
	if afterRules[0].Value != "new" {
		t.Fatalf("RULE-SET reference was not renamed: %#v", afterRules[0])
	}
	if err := st.ReplaceCurrentRules(afterRules, nil); err == nil || !strings.Contains(err.Error(), "仍被 1 条规则引用") {
		t.Fatalf("deleting referenced provider should fail, got %v", err)
	}
	if err := st.ReplaceCurrentRules(nil, nil); err != nil {
		t.Fatalf("deleting unreferenced provider failed: %v", err)
	}
}
