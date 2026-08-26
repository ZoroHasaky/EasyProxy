package service

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func TestSimulateOutboundMatchesLocalRulesWithoutNetworkAccess(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
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

	result, err := SimulateOutbound(st, dir, "api.github.com")
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
	dir := t.TempDir()
	st, err := store.Open(dir)
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

	result, err := SimulateOutbound(st, dir, "example.com")
	if err != nil {
		t.Fatal(err)
	}
	if result.Certain || result.RuleName != "兜底" || len(result.Limitations) != 1 || !strings.Contains(result.Limitations[0], "尚未下载到本机") {
		t.Fatalf("unexpected limited simulation result: %#v", result)
	}
}

func TestSimulateOutboundUsesDownloadedGeoAndRuleProviderData(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := os.WriteFile(filepath.Join(dir, "GeoIP.dat"), simulationGeoIPFile("CN", []byte{1, 2, 3, 0}, 24), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "GeoSite.dat"), simulationGeoSiteFile("cn", "bilibili.com"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{
		{Name: "远程 GitHub", Kind: "RULE-SET", SourceURL: "https://example.com/github.yaml", SourceBehavior: "domain", SourceInterval: 3600, Priority: 30, Enabled: true},
		{Name: "中国大陆域名", Kind: "GEOSITE", Conditions: []string{"cn"}, Priority: 20, Enabled: true},
		{Name: "中国大陆 IP", Kind: "GEOIP", Conditions: []string{"CN"}, Priority: 20, Enabled: true},
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
	if err := os.MkdirAll(filepath.Join(dir, "ruleset"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ruleset", "recognition-"+strconv.FormatInt(ids["远程 GitHub"], 10)+".yaml"), []byte("payload:\n  - '+.github.com'\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceOutboundRules([]model.OutboundRule{
		{RecognitionID: ids["远程 GitHub"], GroupID: model.OutboundTargetRejectID, Enabled: true},
		{RecognitionID: ids["中国大陆域名"], GroupID: model.OutboundTargetDirectID, Enabled: true},
		{RecognitionID: ids["中国大陆 IP"], GroupID: model.OutboundTargetDirectID, Enabled: true},
		{RecognitionID: ids["兜底"], GroupID: model.OutboundTargetProxyID, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct {
		target     string
		rule       string
		targetName string
	}{
		{target: "api.github.com", rule: "远程 GitHub", targetName: model.BuiltinReject},
		{target: "www.bilibili.com", rule: "中国大陆域名", targetName: model.BuiltinDirect},
		{target: "1.2.3.4", rule: "中国大陆 IP", targetName: model.BuiltinDirect},
	} {
		result, err := SimulateOutbound(st, dir, test.target)
		if err != nil {
			t.Fatalf("simulate %s: %v", test.target, err)
		}
		if !result.Certain || result.RuleName != test.rule || result.OutboundTarget != test.targetName || len(result.Limitations) != 0 {
			t.Fatalf("simulate %s = %#v", test.target, result)
		}
	}
}

func TestSimulateOutboundRejectsNonHostTarget(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if _, err := SimulateOutbound(st, dir, "https://example.com/path"); err == nil {
		t.Fatal("expected invalid target to be rejected")
	}
}

func simulationGeoIPFile(category string, address []byte, prefix uint64) []byte {
	cidr := append(simulationProtoBytes(1, address), simulationProtoVarint(2, prefix)...)
	record := append(simulationProtoBytes(1, []byte(category)), simulationProtoBytes(2, cidr)...)
	return simulationProtoBytes(1, record)
}

func simulationGeoSiteFile(category, domain string) []byte {
	entry := append(simulationProtoVarint(1, 2), simulationProtoBytes(2, []byte(domain))...)
	record := append(simulationProtoBytes(1, []byte(category)), simulationProtoBytes(2, entry)...)
	return simulationProtoBytes(1, record)
}

func simulationProtoBytes(field int, value []byte) []byte {
	return append([]byte{byte(field<<3 | 2), byte(len(value))}, value...)
}

func simulationProtoVarint(field int, value uint64) []byte {
	out := []byte{byte(field << 3)}
	for value >= 0x80 {
		out = append(out, byte(value)|0x80)
		value >>= 7
	}
	return append(out, byte(value))
}
