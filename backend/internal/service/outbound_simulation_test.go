package service

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func TestSimulateOutboundMatchesLocalRulesWithoutNetworkAccess(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{
		{Name: "GitHub", Kind: "DOMAIN-SUFFIX", Conditions: []string{"github.com"}, Priority: 10, Enabled: true},
		{Name: "兜底", Kind: "MATCH", Priority: 0, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	rules, err := st.ListRecognitionRules()
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]int64{}
	for _, rule := range rules {
		ids[rule.Name] = rule.ID
	}
	if err := st.ReplaceOutboundRules([]model.OutboundRule{
		{RecognitionID: ids["GitHub"], GroupID: model.OutboundTargetDirectID, Enabled: true},
		{RecognitionID: ids["兜底"], GroupID: model.OutboundTargetProxyID, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}

	result, err := SimulateOutbound(st, "api.github.com")
	if err != nil {
		t.Fatal(err)
	}
	if !result.Certain || result.RuleName != "GitHub" || result.RuleCondition != "github.com" || result.OutboundTarget != model.BuiltinDirect {
		t.Fatalf("unexpected simulation result: %#v", result)
	}
	if got, want := strings.Join(result.Chain, " → "), "GitHub → DIRECT"; got != want {
		t.Fatalf("chain=%q, want %q", got, want)
	}
}

func TestSimulateOutboundReportsRulesItCannotEvaluateOffline(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{
		{Name: "远程来源", SourceURL: "https://example.com/rules.yaml", SourceBehavior: "domain", SourceInterval: 3600, Priority: 10, Enabled: true},
		{Name: "兜底", Kind: "MATCH", Priority: 0, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	rules, _ := st.ListRecognitionRules()
	ids := map[string]int64{}
	for _, rule := range rules {
		ids[rule.Name] = rule.ID
	}
	if err := st.ReplaceOutboundRules([]model.OutboundRule{
		{RecognitionID: ids["远程来源"], GroupID: model.OutboundTargetDirectID, Enabled: true},
		{RecognitionID: ids["兜底"], GroupID: model.OutboundTargetProxyID, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}

	result, err := SimulateOutbound(st, "example.com")
	if err != nil {
		t.Fatal(err)
	}
	if result.Certain || result.RuleName != "兜底" || len(result.Limitations) != 1 || !strings.Contains(result.Limitations[0], "远程 YAML") {
		t.Fatalf("unexpected limited simulation result: %#v", result)
	}
}

func TestSimulateOutboundRejectsNonHostTarget(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if _, err := SimulateOutbound(st, "https://example.com/path"); err == nil {
		t.Fatal("expected invalid target to be rejected")
	}
}
