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

func TestProxyPortHandlersManagePortsAndRules(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")

	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{{Name: "测试", Kind: "DOMAIN", Conditions: []string{"example.com"}, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	recognitions, _ := st.ListRecognitionRules()
	if err := st.ReplaceGroups([]model.Group{{Name: "测试组", Type: "select", Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	groups, _ := st.ListGroups()

	createReq := httptest.NewRequest(http.MethodPost, "/api/proxy-ports", bytes.NewBufferString(`{"name":"工作端口","port":7891,"default_target":"DIRECT"}`))
	createRec := httptest.NewRecorder()
	srv.handleCreateProxyPort(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", createRec.Code, createRec.Body.String())
	}
	var created struct {
		Item model.ProxyPort `json:"item"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Item.Port != 7891 || created.Item.DefaultTarget != "DIRECT" {
		t.Fatalf("created item=%#v", created.Item)
	}

	rulesBody, _ := json.Marshal(map[string]any{"rules": []model.ProxyPortRule{{RecognitionID: recognitions[0].ID, GroupID: groups[0].ID, Enabled: true}}})
	rulesReq := httptest.NewRequest(http.MethodPut, "/api/proxy-ports/2/rules", bytes.NewReader(rulesBody))
	rulesRec := httptest.NewRecorder()
	srv.handlePutProxyPortRules(rulesRec, rulesReq)
	if rulesRec.Code != http.StatusOK {
		t.Fatalf("rules status=%d body=%s", rulesRec.Code, rulesRec.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/proxy-ports", nil)
	listRec := httptest.NewRecorder()
	srv.handleGetProxyPorts(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listRec.Code, listRec.Body.String())
	}
	var listed struct {
		Items []model.ProxyPort `json:"items"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Items) != 2 || len(listed.Items[1].Rules) != 1 || listed.Items[1].Rules[0].GroupID != groups[0].ID {
		t.Fatalf("listed ports=%#v", listed.Items)
	}
}
