package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"easyproxy/internal/store"
)

func TestCreateSubscriptionKeepsRequestedEnabledState(t *testing.T) {
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`proxies:
  - name: audit-node
    type: ss
    server: 127.0.0.1
    port: 8388
    cipher: aes-128-gcm
    password: audit-password
`))
	}))
	defer source.Close()

	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")

	body, _ := json.Marshal(map[string]any{
		"name":            "audit-subscription",
		"url":             source.URL,
		"update_interval": 0,
		"enabled":         false,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/subscriptions", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	srv.handleCreateSub(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	subs, err := st.ListSubscriptions()
	if err != nil {
		t.Fatal(err)
	}
	if len(subs) != 1 || subs[0].Enabled {
		t.Fatalf("created subscription enabled=%v, want false: %#v", len(subs) == 1 && subs[0].Enabled, subs)
	}
}

func TestUpdateProxyAddrHonorsSetting(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")

	if addr, err := srv.updateProxyAddr(); err != nil || addr != "" {
		t.Fatalf("disabled proxy addr=%q err=%v", addr, err)
	}
	if err := st.SetSetting("update_via_proxy", "1"); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.updateProxyAddr(); err == nil {
		t.Fatal("enabled proxy without a running core should return an actionable error")
	}
}
