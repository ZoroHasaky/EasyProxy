package service

import (
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"

	"gopkg.in/yaml.v3"
)

func TestGenerateClashExportOnlyIncludesRoutingAndRequiredGeoData(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.SetSettingJSON("geox_urls", map[string][]string{
		"geoip":   {"https://geo.example/geoip.dat"},
		"geosite": {"https://geo.example/geosite.dat"},
	}); err != nil {
		t.Fatal(err)
	}
	node := testNode(0, "导出节点", "export-node", "JP", true)
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{
		{Name: "中国 IP", Kind: "GEOIP", Conditions: []string{"CN"}, Priority: 2, Enabled: true},
		{Name: "GitHub", Kind: "GEOSITE", Conditions: []string{"github"}, Priority: 1, Enabled: true},
		{Name: "兜底", Kind: "MATCH", Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	recognitions, err := st.ListRecognitionRules()
	if err != nil {
		t.Fatal(err)
	}
	mappings := make([]model.OutboundRule, 0, len(recognitions))
	for _, recognition := range recognitions {
		mappings = append(mappings, model.OutboundRule{RecognitionID: recognition.ID, GroupID: model.OutboundTargetProxyID, Enabled: true})
	}
	if err := st.ReplaceOutboundRules(mappings); err != nil {
		t.Fatal(err)
	}

	generated, err := GenerateClashExport(st)
	if err != nil {
		t.Fatal(err)
	}
	var exported map[string]any
	if err := yaml.Unmarshal([]byte(generated.YAML), &exported); err != nil {
		t.Fatalf("exported YAML is invalid: %v\n%s", err, generated.YAML)
	}
	for _, key := range []string{"mode", "proxies", "proxy-groups", "rules", "geox-url", "geodata-mode", "geo-auto-update", "geo-update-interval"} {
		if _, ok := exported[key]; !ok {
			t.Fatalf("missing export field %q: %#v", key, exported)
		}
	}
	for _, key := range []string{"mixed-port", "allow-lan", "bind-address", "log-level", "external-controller", "secret", "tun", "sniffer", "dns", "profile"} {
		if _, ok := exported[key]; ok {
			t.Fatalf("export leaked local setting %q: %#v", key, exported[key])
		}
	}
	sources := exported["geox-url"].(map[string]any)
	if sources["geoip"] != "https://geo.example/geoip.dat" || sources["geosite"] != "https://geo.example/geosite.dat" {
		t.Fatalf("unexpected Geo sources: %#v", sources)
	}
	if exported["geo-auto-update"] != true || exported["geo-update-interval"] != 24 {
		t.Fatalf("unexpected Geo update settings: %#v", exported)
	}
}

func TestGenerateClashExportOmitsGeoDataWhenRulesDoNotUseIt(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	node := testNode(0, "普通节点", "export-no-geo", "HK", true)
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	generated, err := GenerateClashExport(st)
	if err != nil {
		t.Fatal(err)
	}
	var exported map[string]any
	if err := yaml.Unmarshal([]byte(generated.YAML), &exported); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"geox-url", "geodata-mode", "geo-auto-update", "geo-update-interval"} {
		if _, ok := exported[key]; ok {
			t.Fatalf("unexpected Geo field %q: %#v", key, exported[key])
		}
	}
}
