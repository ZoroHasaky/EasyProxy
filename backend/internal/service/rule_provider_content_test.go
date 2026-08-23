package service

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func TestParseRuleProviderContentSearchAndPagination(t *testing.T) {
	yamlContent := "payload:\n  - example.com\n  - api.example.com\n  - 1.1.1.0/24\n"
	result, err := ParseRuleProviderContent(yamlContent, "yaml", "example", 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 2 || len(result.Items) != 1 || result.Items[0] != "example.com" {
		t.Fatalf("unexpected YAML result: %#v", result)
	}
	textContent := "# comment\nexample.org\n\n2.2.2.0/24\n"
	result, err = ParseRuleProviderContent(textContent, "text", "", 1, 100)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 2 || result.Items[1] != "2.2.2.0/24" {
		t.Fatalf("unexpected text result: %#v", result)
	}
	if _, err := ParseRuleProviderContent("binary", "mrs", "", 1, 100); err == nil {
		t.Fatal("MRS content should not be parsed")
	}
}

func TestGenerateConfigUsesCurrentRuleProvidersAndFormatExtension(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	providers := []model.RuleProvider{{Name: "private", URL: "https://example.com/private.mrs", Behavior: "domain", Format: "mrs", Interval: 86400}}
	rules := []model.Rule{{Kind: "RULE-SET", Value: "private", Target: "DIRECT", BaseTarget: "DIRECT", Enabled: true}, {Kind: "MATCH", Target: "PROXY", BaseTarget: "PROXY", Enabled: true}}
	if err := st.ReplaceCurrentRules(rules, providers); err != nil {
		t.Fatal(err)
	}
	generated, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"private":`, "format: mrs", `path: "./ruleset/private.mrs"`, "RULE-SET,private,DIRECT"} {
		if !strings.Contains(generated.YAML, want) {
			t.Fatalf("missing %q in config:\n%s", want, generated.YAML)
		}
	}
}
