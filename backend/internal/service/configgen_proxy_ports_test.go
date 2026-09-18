package service

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"

	"gopkg.in/yaml.v3"
)

func TestGenerateConfigUsesIndependentProxyPortSubRules(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	node := testNode(1, "测试节点", "proxy-port-node", "HK", true)
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{{
		Name: "测试域名", Kind: "DOMAIN-SUFFIX", Conditions: []string{"example.com"}, Priority: 20, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	recognitions, _ := st.ListRecognitionRules()
	if err := st.ReplaceOutboundRules([]model.OutboundRule{{RecognitionID: recognitions[0].ID, GroupID: model.OutboundTargetDirectID, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	ports, err := st.ListProxyPorts()
	if err != nil || len(ports) != 1 {
		t.Fatalf("proxy ports=%#v err=%v", ports, err)
	}
	if err := st.ReplaceProxyPortRules(ports[0].ID, []model.ProxyPortRule{{RecognitionID: recognitions[0].ID, GroupID: model.OutboundTargetDirectID, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	legacy, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(legacy.YAML, "mixed-port: 7890") || strings.Contains(legacy.YAML, "listeners:") {
		t.Fatalf("single-port config shape is wrong:\n%s", legacy.YAML)
	}
	second := &model.ProxyPort{Name: "代理端口", Port: 7891, Enabled: true, DefaultTarget: "DIRECT"}
	if err := st.CreateProxyPort(second); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceProxyPortRules(second.ID, []model.ProxyPortRule{{RecognitionID: recognitions[0].ID, GroupID: model.OutboundTargetProxyID, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateProxyPort(&model.ProxyPort{Name: "停用端口", Port: 7892, Enabled: false, DefaultTarget: "DIRECT"}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.UpdateConfigSettingsAndSyncPending(map[string]string{"multi_port_routing": "1"}); err != nil {
		t.Fatal(err)
	}

	generated, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(generated.YAML, "mixed-port:") || !strings.Contains(generated.YAML, "listeners:") || !strings.Contains(generated.YAML, "sub-rules:") {
		t.Fatalf("multi-port config shape is wrong:\n%s", generated.YAML)
	}
	var parsed map[string]any
	if err := yaml.Unmarshal([]byte(generated.YAML), &parsed); err != nil {
		t.Fatalf("generated YAML invalid: %v\n%s", err, generated.YAML)
	}
	listeners, ok := parsed["listeners"].([]any)
	if !ok || len(listeners) != 2 {
		t.Fatalf("listeners=%#v", parsed["listeners"])
	}
	subRules, ok := parsed["sub-rules"].(map[string]any)
	if !ok || len(subRules) != 2 {
		t.Fatalf("sub-rules=%#v", parsed["sub-rules"])
	}
	if !strings.Contains(generated.YAML, "DOMAIN-SUFFIX,example.com,DIRECT") || !strings.Contains(generated.YAML, "DOMAIN-SUFFIX,example.com,PROXY") {
		t.Fatalf("port-specific targets missing:\n%s", generated.YAML)
	}
	if !strings.Contains(generated.YAML, "MATCH,DIRECT") {
		t.Fatalf("default target missing:\n%s", generated.YAML)
	}
}
