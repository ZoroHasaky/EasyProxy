package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"easyproxy/internal/store"
)

func TestOutboundSimulationEndpointRequiresLogin(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, t.TempDir(), "test")
	handler := srv.Handler()
	body := []byte(`{"target":"example.com"}`)

	req := httptest.NewRequest(http.MethodPost, "/api/outbound-rules/simulate", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/outbound-rules/simulate", bytes.NewReader(body))
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: srv.sessions.Create()})
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authenticated status=%d body=%s", rec.Code, rec.Body.String())
	}
}
