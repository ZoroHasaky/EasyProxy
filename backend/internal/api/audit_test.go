package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easyproxy/internal/core"
	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func TestAuditLogHandlersFilterAndExport(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, t.TempDir(), "test")
	srv.audit("operation", "node.import", "success", "节点已导入", map[string]any{"count": 3})
	srv.audit("core", "core.restart", "success", "Mihomo 内核已重启", nil)

	req := httptest.NewRequest(http.MethodGet, "/api/logs?category=core", nil)
	rec := httptest.NewRecorder()
	srv.handleListAuditLogs(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Mihomo 内核已重启") || strings.Contains(rec.Body.String(), "节点已导入") || !strings.Contains(rec.Body.String(), `"details":{}`) {
		t.Fatalf("list status=%d body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/logs/export?category=operation", nil)
	rec = httptest.NewRecorder()
	srv.handleExportAuditLogs(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "节点已导入") || !strings.Contains(rec.Body.String(), `"count":3`) || !strings.Contains(rec.Header().Get("Content-Disposition"), "easyproxy-logs") {
		t.Fatalf("export status=%d headers=%v body=%s", rec.Code, rec.Header(), rec.Body.String())
	}
}

func TestAuditLogEndpointsRequireLogin(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, t.TempDir(), "test")
	handler := srv.Handler()

	for _, path := range []string{"/api/logs", "/api/logs/export"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated %s returned status=%d", path, rec.Code)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/logs", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: srv.sessions.Create()})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated list returned status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestConnectionTraceIsDeduplicatedAndSanitized(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, t.TempDir(), "test")
	connection := core.Connection{
		ID: "connection-id", Chains: []string{"PROXY", "香港节点"}, Rule: "DOMAIN-SUFFIX", RulePayload: "example.com",
		Metadata: core.ConnectionMetadata{Host: "example.com", DestinationPort: "443", Network: "tcp", Type: "HTTPS"},
	}
	srv.recordConnectionTrace(connection)
	srv.recordConnectionTrace(connection)
	items, _, err := st.ListAuditLogs(modelAuditTraffic())
	if err != nil || len(items) != 1 {
		t.Fatalf("items=%#v err=%v", items, err)
	}
	if _, exists := items[0].Details["sourceIP"]; exists || items[0].Details["target"] != "example.com" || items[0].Details["rule"] != "DOMAIN-SUFFIX" {
		t.Fatalf("unsafe or incomplete details=%#v", items[0].Details)
	}
}

func modelAuditTraffic() model.AuditLogFilter { return model.AuditLogFilter{Category: "traffic"} }
