package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"easyproxy/internal/core"
	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func TestPreviewRuleTemplateDoesNotPersist(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")
	body := map[string]string{"content": "rule-providers:\n  private:\n    behavior: domain\n    format: yaml\n    url: https://example.com/private.yaml\nrules:\n  - RULE-SET,private,DIRECT\n  - MATCH,PROXY\n"}
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/rules/template-preview", bytes.NewReader(data))
	rec := httptest.NewRecorder()
	srv.handlePreviewRuleTemplate(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	rules, _ := st.ListCurrentRules()
	providers, _ := st.ListCurrentRuleProviders()
	templates, _ := st.ListTemplates()
	if len(rules) != 0 || len(providers) != 0 || len(templates) != 0 {
		t.Fatalf("preview persisted data: rules=%#v providers=%#v templates=%#v", rules, providers, templates)
	}
}

func TestMRSRuleProviderIsRejected(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.ReplaceCurrentRules(nil, []model.RuleProvider{{
		Name: "private", URL: "https://invalid.example/private.mrs", Behavior: "domain", Format: "mrs", Interval: 86400,
	}}); err == nil {
		t.Fatal("MRS rule provider should be rejected")
	}
	if err := st.ReplaceRules(1, nil, []model.RuleProvider{{
		Name: "private", URL: "https://invalid.example/private.mrs", Behavior: "domain", Format: "mrs", Interval: 86400,
	}}); err == nil {
		t.Fatal("template MRS rule provider should be rejected")
	}
	if err := st.ReplaceCurrentRules(nil, []model.RuleProvider{{
		Name: "disguised", URL: "https://invalid.example/disguised.mrs", Behavior: "domain", Format: "yaml", Interval: 86400,
	}}); err == nil {
		t.Fatal("MRS URL should be rejected even when format is YAML")
	}
}

func TestApplyRuleProviderRuntimeStatus(t *testing.T) {
	providers := []model.RuleProvider{{Name: "ready"}, {Name: "pending"}, {Name: "missing"}}
	applyRuleProviderRuntimeStatus(providers, map[string]core.RuleProviderRuntime{
		"ready":   {RuleCount: 12, UpdatedAt: "2026-01-01T00:00:00Z"},
		"pending": {},
	})
	if providers[0].Status != "downloaded" || providers[0].RuleCount != 12 {
		t.Fatalf("ready=%#v", providers[0])
	}
	if providers[1].Status != "not_downloaded" || providers[2].Status != "not_loaded" {
		t.Fatalf("pending=%#v missing=%#v", providers[1], providers[2])
	}
}

func TestTunConfigNeedsRestart(t *testing.T) {
	tests := []struct {
		name           string
		running        map[string]any
		desiredEnabled bool
		desiredStack   string
		want           bool
	}{
		{
			name: "配置一致",
			running: map[string]any{"tun": map[string]any{
				"enable": true, "stack": "mixed",
			}},
			desiredEnabled: true,
			desiredStack:   "mixed",
		},
		{
			name: "启用状态改变",
			running: map[string]any{"tun": map[string]any{
				"enable": false, "stack": "mixed",
			}},
			desiredEnabled: true,
			desiredStack:   "mixed",
			want:           true,
		},
		{
			name: "协议栈改变",
			running: map[string]any{"tun": map[string]any{
				"enable": true, "stack": "mixed",
			}},
			desiredEnabled: true,
			desiredStack:   "system",
			want:           true,
		},
		{
			name: "TUN 关闭时协议栈差异无需重启",
			running: map[string]any{"tun": map[string]any{
				"enable": false, "stack": "mixed",
			}},
			desiredEnabled: false,
			desiredStack:   "system",
		},
		{
			name:           "运行配置缺少 TUN",
			running:        map[string]any{},
			desiredEnabled: true,
			desiredStack:   "mixed",
			want:           true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tunConfigNeedsRestart(tt.running, tt.desiredEnabled, tt.desiredStack); got != tt.want {
				t.Fatalf("tunConfigNeedsRestart()=%v, want %v", got, tt.want)
			}
		})
	}
}
