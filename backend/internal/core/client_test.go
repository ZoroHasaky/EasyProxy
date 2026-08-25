package core

import (
	"net"
	"net/http"
	"testing"
)

func TestUpdateGeoDatabasesCallsMihomoEndpoint(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	requests := make(chan struct{}, 1)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/configs/geo" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-secret" {
			t.Errorf("authorization=%q", got)
		}
		requests <- struct{}{}
		w.WriteHeader(http.StatusNoContent)
	})}
	defer server.Close()
	go server.Serve(listener)

	port := listener.Addr().(*net.TCPAddr).Port
	client := NewClient(port, "test-secret")
	if err := client.UpdateGeoDatabases(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-requests:
	default:
		t.Fatal("mihomo geo refresh endpoint was not called")
	}
}
