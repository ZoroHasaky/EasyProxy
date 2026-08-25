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

func TestPatchManualNodeUpdatesFullProxyConfig(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	node := model.Node{
		Name: "旧节点", Type: "vmess", Server: "old.example.com", Port: 443,
		SourceType: "manual", Enabled: true, DedupHash: "old-hash",
		RawConfig: map[string]any{
			"name": "旧节点", "type": "vmess", "server": "old.example.com", "port": 443,
			"uuid": "old-uuid", "tls": false,
		},
	}
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	srv := New(st, dir, "test")

	body := []byte(`{"raw_config":{"name":"新节点","type":"vless","server":"new.example.com","port":8443,"uuid":"new-uuid","tls":true,"flow":"xtls-rprx-vision"},"region":"US"}`)
	req := httptest.NewRequest(http.MethodPatch, "/api/nodes/1", bytes.NewReader(body))
	req.SetPathValue("id", "1")
	rec := httptest.NewRecorder()
	srv.handlePatchNode(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH status=%d body=%s", rec.Code, rec.Body.String())
	}
	var response struct {
		Node model.Node `json:"node"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Node.Name != "新节点" || response.Node.Type != "vless" || response.Node.Server != "new.example.com" || response.Node.Port != 8443 || response.Node.Region != "US" {
		t.Fatalf("unexpected response node: %#v", response.Node)
	}
	if response.Node.RawConfig["uuid"] != "new-uuid" || response.Node.RawConfig["flow"] != "xtls-rprx-vision" || response.Node.RawConfig["tls"] != true {
		t.Fatalf("full proxy config not preserved: %#v", response.Node.RawConfig)
	}

	saved, err := st.GetNode(node.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.DedupHash == "old-hash" || saved.RawConfig["port"] != float64(8443) {
		t.Fatalf("updated node was not persisted: %#v", saved)
	}
}

func TestPatchSubscriptionNodeRejectsFullProxyConfig(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	node := model.Node{
		Name: "订阅节点", Type: "ss", Server: "sub.example.com", Port: 443,
		SourceType: "sub", SourceID: 1, Enabled: true, DedupHash: "sub-hash",
		RawConfig: map[string]any{"name": "订阅节点", "type": "ss", "server": "sub.example.com", "port": 443},
	}
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	srv := New(st, dir, "test")

	req := httptest.NewRequest(http.MethodPatch, "/api/nodes/1", bytes.NewBufferString(`{"raw_config":{"name":"改名","type":"ss","server":"changed.example.com","port":443}}`))
	req.SetPathValue("id", "1")
	rec := httptest.NewRecorder()
	srv.handlePatchNode(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("PATCH status=%d body=%s", rec.Code, rec.Body.String())
	}
}
