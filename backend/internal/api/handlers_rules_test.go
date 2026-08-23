package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
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

func TestMRSProviderContentReturnsMetadataWithoutDownload(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.ReplaceCurrentRules(nil, []model.RuleProvider{{
		Name: "private", URL: "https://invalid.example/private.mrs", Behavior: "domain", Format: "mrs", Interval: 86400,
	}}); err != nil {
		t.Fatal(err)
	}
	providers, _ := st.ListCurrentRuleProviders()
	srv := New(st, dir, "test")
	req := httptest.NewRequest(http.MethodGet, "/api/rule-providers/1/content", nil)
	req.SetPathValue("id", strconv.FormatInt(providers[0].ID, 10))
	rec := httptest.NewRecorder()
	srv.handleRuleProviderContent(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var result struct {
		Expandable bool               `json:"expandable"`
		Provider   model.RuleProvider `json:"provider"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Expandable || result.Provider.Status != "core_stopped" {
		t.Fatalf("unexpected result: %#v", result)
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
