package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func callRecognitionImport(t *testing.T, srv *Server, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/recognition-rules/import", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	srv.handleImportRecognitionRules(rec, req)
	return rec
}

func TestImportRecognitionRulesFromURLAndYAML(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")

	urlImport := callRecognitionImport(t, srv, map[string]any{
		"url": "https://example.com/rules/apple.yaml", "priority": 7, "enabled": true,
	})
	if urlImport.Code != http.StatusOK {
		t.Fatalf("URL import status=%d body=%s", urlImport.Code, urlImport.Body.String())
	}
	yamlImport := callRecognitionImport(t, srv, map[string]any{
		"content":  "rule-providers:\n  private-ip:\n    type: http\n    behavior: ipcidr\n    url: https://example.com/rules/private.yaml\n    format: yaml\n    interval: 3600\n  classical:\n    type: http\n    behavior: classical\n    url: https://example.com/rules/classical.yaml\n",
		"priority": 3,
	})
	if yamlImport.Code != http.StatusOK {
		t.Fatalf("YAML import status=%d body=%s", yamlImport.Code, yamlImport.Body.String())
	}
	rules, err := st.ListRecognitionRules()
	if err != nil || len(rules) != 3 {
		t.Fatalf("rules=%#v err=%v", rules, err)
	}
	byName := map[string]struct {
		behavior string
		interval int
		priority int
		url      string
	}{}
	for _, rule := range rules {
		byName[rule.Name] = struct {
			behavior string
			interval int
			priority int
			url      string
		}{rule.SourceBehavior, rule.SourceInterval, rule.Priority, rule.SourceURL}
	}
	if apple := byName["apple"]; apple.behavior != "domain" || apple.priority != 7 || apple.url != "https://example.com/rules/apple.yaml" {
		t.Fatalf("URL rule=%#v", apple)
	}
	if private := byName["private-ip"]; private.behavior != "ipcidr" || private.interval != 3600 {
		t.Fatalf("YAML rule=%#v", private)
	}

	standaloneImport := callRecognitionImport(t, srv, map[string]any{
		"content":  "payload:\n  - +.github.com\n  - api.github.com\n",
		"url":      "https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/geosite/github.yaml",
		"priority": 9,
	})
	if standaloneImport.Code != http.StatusOK {
		t.Fatalf("standalone YAML import status=%d body=%s", standaloneImport.Code, standaloneImport.Body.String())
	}
	rules, err = st.ListRecognitionRules()
	if err != nil || len(rules) != 4 {
		t.Fatalf("rules after standalone import=%#v err=%v", rules, err)
	}
	github := nextRecognitionRuleByName(rules, "github")
	if github == nil || github.Priority != 9 || github.SourceURL != "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/github.yaml" {
		t.Fatalf("standalone YAML rule=%#v", github)
	}

	preview := callRecognitionImport(t, srv, map[string]any{
		"content": "rule-providers:\n  preview-only:\n    type: http\n    behavior: domain\n    url: https://example.com/preview.yaml\n    format: yaml\n",
		"preview": true,
	})
	if preview.Code != http.StatusOK {
		t.Fatalf("preview status=%d body=%s", preview.Code, preview.Body.String())
	}
	rules, _ = st.ListRecognitionRules()
	if len(rules) != 4 {
		t.Fatalf("preview persisted rules=%#v", rules)
	}

	duplicate := callRecognitionImport(t, srv, map[string]any{
		"content": "rule-providers:\n  github:\n    type: http\n    behavior: domain\n    url: https://example.com/duplicate.yaml\n    format: yaml\n  should-not-save:\n    type: http\n    behavior: domain\n    url: https://example.com/new.yaml\n    format: yaml\n",
	})
	if duplicate.Code != http.StatusBadRequest {
		t.Fatalf("duplicate status=%d body=%s", duplicate.Code, duplicate.Body.String())
	}
	rules, _ = st.ListRecognitionRules()
	if len(rules) != 4 {
		t.Fatalf("duplicate batch was partially saved: %#v", rules)
	}

	for _, payload := range []map[string]any{
		{"url": "https://example.com/legacy.mrs"},
		{"content": "rule-providers:\n  invalid:\n    type: http\n    behavior: domain\n    url: https://example.com/invalid.yaml\n    format: mrs\n"},
		{"url": "file:///tmp/rules.yaml"},
	} {
		rec := callRecognitionImport(t, srv, payload)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid import status=%d body=%s", rec.Code, rec.Body.String())
		}
	}
}

func nextRecognitionRuleByName(rules []model.RecognitionRule, name string) *model.RecognitionRule {
	for i := range rules {
		if rules[i].Name == name {
			return &rules[i]
		}
	}
	return nil
}

func TestRecognitionImportEndpointRequiresLogin(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")
	handler := srv.Handler()
	body := []byte(`{"url":"https://example.com/apple.yaml"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/recognition-rules/import", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/recognition-rules/import", bytes.NewReader(body))
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: srv.sessions.Create()})
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated status=%d body=%s", rec.Code, rec.Body.String())
	}
}
