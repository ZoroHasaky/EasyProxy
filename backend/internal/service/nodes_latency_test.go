package service

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"easyproxy/internal/core"
	"easyproxy/internal/store"
)

func TestCheckLatenciesOnlyTestsSelectedNodes(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	nodes := []struct {
		name string
		hash string
	}{
		{name: "手动节点一", hash: "latency-hash-1"},
		{name: "手动节点二", hash: "latency-hash-2"},
		{name: "手动节点三", hash: "latency-hash-3"},
	}
	created := make([]int64, 0, len(nodes))
	for _, item := range nodes {
		node := testNode(0, item.name, item.hash, "HK", true)
		if err := st.CreateNode(&node); err != nil {
			t.Fatal(err)
		}
		created = append(created, node.ID)
	}

	var mu sync.Mutex
	requested := map[string]int{}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		namePath := strings.TrimSuffix(strings.TrimPrefix(r.URL.EscapedPath(), "/proxies/"), "/delay")
		name, _ := url.PathUnescape(namePath)
		mu.Lock()
		requested[name]++
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]int{"delay": 42})
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	server.Start()
	defer server.Close()
	client := core.NewClient(listener.Addr().(*net.TCPAddr).Port, "")

	tested, err := CheckLatencies(st, client, []int64{created[0], created[2]})
	if err != nil {
		t.Fatal(err)
	}
	if tested != 2 {
		t.Fatalf("tested=%d, want 2", tested)
	}
	if requested[nodes[0].name] != 1 || requested[nodes[2].name] != 1 {
		t.Fatalf("selected requests=%#v", requested)
	}
	if requested[nodes[1].name] != 0 {
		t.Fatalf("unselected node was tested: %#v", requested)
	}
	unselected, err := st.GetNode(created[1])
	if err != nil {
		t.Fatal(err)
	}
	if !unselected.LatencyAt.IsZero() {
		t.Fatalf("unselected node latency was updated: %#v", unselected)
	}
}
