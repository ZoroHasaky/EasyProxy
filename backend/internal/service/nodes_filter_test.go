package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func TestIsSubscriptionInfoNode(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"剩余流量：128 GB", true},
		{"流量剩余 20%", true},
		{"套餐到期：长期有效", true},
		{"到期时间 2026-12-31", true},
		{"Remaining Traffic: 10GB", true},
		{"Expire Date: 2026-12-31", true},
		{"距离下次重置剩余：14 天", true},
		{"建议：感到卡顿请切换到专线节点", true},
		{"放丢失官网", true},
		{"放丢失官网2", true},
		{"防丢失官网", true},
		{"🇭🇰 香港 01", false},
		{"长期有效专线", false},
		{"高速流量节点", false},
	}
	for _, tt := range tests {
		if got := isSubscriptionInfoNode(tt.name); got != tt.want {
			t.Errorf("isSubscriptionInfoNode(%q) = %v, want %v", tt.name, got, tt.want)
		}
	}
}

func TestSyncSubscriptionFiltersInfoNodes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`proxies:
  - {name: "剩余流量：100 GB", type: ss, server: info.example.com, port: 443, cipher: aes-128-gcm, password: x}
  - {name: "🇭🇰 香港 01", type: ss, server: hk.example.com, port: 443, cipher: aes-128-gcm, password: y}
  - {name: "套餐到期：长期有效", type: ss, server: expire.example.com, port: 443, cipher: aes-128-gcm, password: z}
`))
	}))
	defer server.Close()

	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	sub := &model.Subscription{Name: "test", URL: server.URL, Enabled: true}
	if err := st.CreateSubscription(sub); err != nil {
		t.Fatal(err)
	}
	added, removed, err := SyncSubscription(st, sub, "")
	if err != nil {
		t.Fatal(err)
	}
	if added != 1 || removed != 0 {
		t.Fatalf("added=%d removed=%d, want 1/0", added, removed)
	}
	nodes, err := st.ListNodes(model.NodeFilter{SourceID: sub.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].Name != "🇭🇰 香港 01" {
		t.Fatalf("filtered nodes = %#v", nodes)
	}
	fresh, err := st.GetSubscription(sub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.NodeCount != 1 {
		t.Fatalf("node_count=%d, want 1", fresh.NodeCount)
	}
}
