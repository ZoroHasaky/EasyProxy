package service

import (
	"strings"
	"testing"

	"easyproxy/internal/store"
)

func TestGeoxSourcesLegacyCompatibility(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.SetSettingJSON("geox_urls", map[string]string{"geoip": "https://legacy.example/geoip.dat"}); err != nil {
		t.Fatal(err)
	}
	sources := GeoxSources(st)
	if len(sources["geoip"]) != 1 || sources["geoip"][0] != "https://legacy.example/geoip.dat" {
		t.Fatalf("legacy sources = %#v", sources)
	}
}

func TestGenerateConfigGeoSettings(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	_ = st.SetSetting("geo_enabled", "1")
	_ = st.SetSetting("geo_auto_update", "1")
	_ = st.SetSetting("geo_update_interval", "12")
	_ = st.SetSettingJSON("geox_urls", map[string][]string{
		"geoip": {"https://first.example/geoip.dat", "https://second.example/geoip.dat"},
	})
	gen, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`geoip: "https://first.example/geoip.dat"`,
		"geo-auto-update: true",
		"geo-update-interval: 12",
	} {
		if !strings.Contains(gen.YAML, want) {
			t.Fatalf("config missing %q:\n%s", want, gen.YAML)
		}
	}
	if strings.Contains(gen.YAML, "second.example") {
		t.Fatalf("secondary URL should not be emitted:\n%s", gen.YAML)
	}
	_ = st.SetSetting("geo_enabled", "0")
	gen, err = GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(gen.YAML, "geox-url:") || strings.Contains(gen.YAML, "geo-auto-update:") {
		t.Fatalf("disabled Geo settings were emitted:\n%s", gen.YAML)
	}
}
