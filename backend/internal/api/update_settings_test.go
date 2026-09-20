package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"easyproxy/internal/store"
)

func TestUpdateSettingsDefaultAndPersistence(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")

	get := func() map[string]any {
		req := httptest.NewRequest(http.MethodGet, "/api/update/settings", nil)
		rec := httptest.NewRecorder()
		srv.handleGetUpdateSettings(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET status=%d body=%s", rec.Code, rec.Body.String())
		}
		var result map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}

	settings := get()
	if settings["via_proxy"] != false || settings["proxy_available"] != false || settings["proxy_addr"] != "" {
		t.Fatalf("unexpected default settings: %#v", settings)
	}

	body := bytes.NewBufferString(`{"via_proxy":true}`)
	req := httptest.NewRequest(http.MethodPut, "/api/update/settings", body)
	rec := httptest.NewRecorder()
	srv.handlePutUpdateSettings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !st.GetSettingBool("update_via_proxy", false) {
		t.Fatal("update_via_proxy was not persisted")
	}

	settings = get()
	if settings["via_proxy"] != true {
		t.Fatalf("via_proxy=%v, want true", settings["via_proxy"])
	}
	if _, err := srv.updateProxyAddr(); err == nil {
		t.Fatal("expected unavailable proxy error when Mihomo is stopped")
	}

	body = bytes.NewBufferString(`{"via_proxy":false}`)
	req = httptest.NewRequest(http.MethodPut, "/api/update/settings", body)
	rec = httptest.NewRecorder()
	srv.handlePutUpdateSettings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("disable PUT status=%d body=%s", rec.Code, rec.Body.String())
	}
	if proxy, err := srv.updateProxyAddr(); err != nil || proxy != "" {
		t.Fatalf("direct update proxy=%q err=%v", proxy, err)
	}
}

func TestUpdateCheckRejectsUnavailableConfiguredProxy(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")
	if err := st.SetSetting("update_via_proxy", "1"); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/update/check", nil)
	rec := httptest.NewRecorder()
	srv.handleUpdateCheck(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("GET check status=%d body=%s", rec.Code, rec.Body.String())
	}
}
