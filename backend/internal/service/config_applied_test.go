package service

import (
	"strings"
	"testing"

	"easyproxy/internal/store"
)

func TestGenerateAppliedConfigDoesNotIncludePendingSystemSettings(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if _, err := st.UpdateConfigSettingsAndSyncPending(map[string]string{
		"mixed_port": "18080",
		"tun_enable": "1",
	}); err != nil {
		t.Fatal(err)
	}

	target, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	applied, err := GenerateAppliedConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(target.YAML, "mixed-port: 18080") || !strings.Contains(target.YAML, "  enable: true") {
		t.Fatalf("target config did not contain saved settings:\n%s", target.YAML)
	}
	if !strings.Contains(applied.YAML, "mixed-port: 7890") || !strings.Contains(applied.YAML, "  enable: false") {
		t.Fatalf("applied config included pending settings:\n%s", applied.YAML)
	}
}
