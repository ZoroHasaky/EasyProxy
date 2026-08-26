package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func TestClashConfigDownloadAndSubscriptionLink(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	first := model.Node{
		Name: "首个导出节点", Type: "ss", Server: "first.example", Port: 443, Enabled: true, DedupHash: "clash-first",
		RawConfig: map[string]any{"name": "首个导出节点", "type": "ss", "server": "first.example", "port": 443, "cipher": "aes-128-gcm", "password": "test"},
	}
	if err := st.CreateNode(&first); err != nil {
		t.Fatal(err)
	}
	srv := New(st, dir, "test")
	handler := srv.Handler()
	authCookie := &http.Cookie{Name: sessionCookie, Value: srv.sessions.Create()}

	unauthorized := httptest.NewRequest(http.MethodGet, "/api/clash-config/download", nil)
	unauthorizedRec := httptest.NewRecorder()
	handler.ServeHTTP(unauthorizedRec, unauthorized)
	if unauthorizedRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated download status=%d", unauthorizedRec.Code)
	}

	download := httptest.NewRequest(http.MethodGet, "/api/clash-config/download", nil)
	download.AddCookie(authCookie)
	downloadRec := httptest.NewRecorder()
	handler.ServeHTTP(downloadRec, download)
	if downloadRec.Code != http.StatusOK || !strings.Contains(downloadRec.Header().Get("Content-Disposition"), "easyproxy-clash.yaml") || !strings.Contains(downloadRec.Body.String(), "首个导出节点") {
		t.Fatalf("download status=%d headers=%v body=%s", downloadRec.Code, downloadRec.Header(), downloadRec.Body.String())
	}

	linkReq := httptest.NewRequest(http.MethodGet, "/api/clash-config/link", nil)
	linkReq.AddCookie(authCookie)
	linkRec := httptest.NewRecorder()
	handler.ServeHTTP(linkRec, linkReq)
	if linkRec.Code != http.StatusOK {
		t.Fatalf("link status=%d body=%s", linkRec.Code, linkRec.Body.String())
	}
	firstToken := srv.st.GetSetting(clashSubscriptionTokenSetting, "")
	if firstToken == "" || !strings.Contains(linkRec.Body.String(), firstToken) {
		t.Fatalf("subscription token not returned: %s", linkRec.Body.String())
	}

	publicReq := httptest.NewRequest(http.MethodGet, "/api/clash-config/subscription/"+firstToken, nil)
	publicRec := httptest.NewRecorder()
	handler.ServeHTTP(publicRec, publicReq)
	if publicRec.Code != http.StatusOK || !strings.Contains(publicRec.Header().Get("Content-Type"), "application/x-yaml") || !strings.Contains(publicRec.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("public subscription status=%d headers=%v", publicRec.Code, publicRec.Header())
	}

	second := model.Node{
		Name: "后续导出节点", Type: "ss", Server: "second.example", Port: 443, Enabled: true, DedupHash: "clash-second",
		RawConfig: map[string]any{"name": "后续导出节点", "type": "ss", "server": "second.example", "port": 443, "cipher": "aes-128-gcm", "password": "test"},
	}
	if err := st.CreateNode(&second); err != nil {
		t.Fatal(err)
	}
	dynamicReq := httptest.NewRequest(http.MethodGet, "/api/clash-config/subscription/"+firstToken, nil)
	dynamicRec := httptest.NewRecorder()
	handler.ServeHTTP(dynamicRec, dynamicReq)
	if dynamicRec.Code != http.StatusOK || !strings.Contains(dynamicRec.Body.String(), "后续导出节点") {
		t.Fatalf("subscription did not refresh dynamically: status=%d body=%s", dynamicRec.Code, dynamicRec.Body.String())
	}

	rotateReq := httptest.NewRequest(http.MethodPost, "/api/clash-config/link/rotate", nil)
	rotateReq.AddCookie(authCookie)
	rotateRec := httptest.NewRecorder()
	handler.ServeHTTP(rotateRec, rotateReq)
	secondToken := srv.st.GetSetting(clashSubscriptionTokenSetting, "")
	if rotateRec.Code != http.StatusOK || secondToken == "" || secondToken == firstToken {
		t.Fatalf("rotate status=%d token=%q body=%s", rotateRec.Code, secondToken, rotateRec.Body.String())
	}

	oldReq := httptest.NewRequest(http.MethodGet, "/api/clash-config/subscription/"+firstToken, nil)
	oldRec := httptest.NewRecorder()
	handler.ServeHTTP(oldRec, oldReq)
	if oldRec.Code != http.StatusNotFound {
		t.Fatalf("old token status=%d", oldRec.Code)
	}
	newReq := httptest.NewRequest(http.MethodGet, "/api/clash-config/subscription/"+secondToken, nil)
	newRec := httptest.NewRecorder()
	handler.ServeHTTP(newRec, newReq)
	if newRec.Code != http.StatusOK {
		t.Fatalf("new token status=%d body=%s", newRec.Code, newRec.Body.String())
	}
}
