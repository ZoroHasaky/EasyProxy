package store

import (
	"testing"

	"easyproxy/internal/model"
)

func subscriptionNode(name, server, hash string) model.Node {
	return model.Node{
		Name:       name,
		Type:       "ss",
		Server:     server,
		Port:       443,
		Region:     "HK",
		RawConfig:  map[string]any{"name": name, "type": "ss", "server": server, "port": 443},
		DedupHash:  hash,
		SourceType: "sub",
		Enabled:    true,
	}
}

func TestSyncSubscriptionNodesReplacesWholeSource(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	manual := subscriptionNode("手工节点", "manual.example.com", "manual-hash")
	manual.SourceType = "manual"
	manual.SourceID = 0
	if err := st.CreateNode(&manual); err != nil {
		t.Fatal(err)
	}

	first := []model.Node{
		subscriptionNode("香港 01", "old-a.example.com", "hash-a"),
		subscriptionNode("香港 02", "old-b.example.com", "hash-b"),
	}
	added, removed, err := st.SyncSubscriptionNodes(10, first)
	if err != nil {
		t.Fatal(err)
	}
	if added != 2 || removed != 0 {
		t.Fatalf("first sync added=%d removed=%d, want 2/0", added, removed)
	}
	old, err := st.ListNodes(model.NodeFilter{SourceID: 10})
	if err != nil {
		t.Fatal(err)
	}
	oldIDs := map[int64]bool{}
	for _, node := range old {
		oldIDs[node.ID] = true
	}
	old[0].Enabled = false
	if err := st.UpdateNode(&old[0]); err != nil {
		t.Fatal(err)
	}

	second := []model.Node{
		subscriptionNode("香港 01", "old-a.example.com", "hash-a"),
		subscriptionNode("香港 03", "new-c.example.com", "hash-c"),
	}
	added, removed, err = st.SyncSubscriptionNodes(10, second)
	if err != nil {
		t.Fatal(err)
	}
	if added != 2 || removed != 2 {
		t.Fatalf("replacement added=%d removed=%d, want 2/2", added, removed)
	}

	current, err := st.ListNodes(model.NodeFilter{SourceID: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(current) != 2 {
		t.Fatalf("nodes=%#v, want 2", current)
	}
	for _, node := range current {
		if oldIDs[node.ID] {
			t.Fatalf("old node ID %d was reused", node.ID)
		}
		if !node.Enabled || !node.LatencyAt.IsZero() || node.Alive {
			t.Fatalf("replacement node retained old state: %#v", node)
		}
	}
	manualNodes, err := st.ListNodes(model.NodeFilter{Source: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	if len(manualNodes) != 1 || manualNodes[0].ID != manual.ID {
		t.Fatalf("manual node was changed: %#v", manualNodes)
	}
}

func TestDeleteSubscriptionRemovesItsNodesOnly(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	first := model.Subscription{Name: "订阅一", URL: "https://one.example.com", Enabled: true}
	second := model.Subscription{Name: "订阅二", URL: "https://two.example.com", Enabled: true}
	if err := st.CreateSubscription(&first); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateSubscription(&second); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.SyncSubscriptionNodes(first.ID, []model.Node{
		subscriptionNode("订阅一节点", "one-node.example.com", "hash-one"),
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.SyncSubscriptionNodes(second.ID, []model.Node{
		subscriptionNode("订阅二节点", "two-node.example.com", "hash-two"),
	}); err != nil {
		t.Fatal(err)
	}
	manual := subscriptionNode("手工节点", "manual.example.com", "hash-manual")
	manual.SourceType = "manual"
	manual.SourceID = 0
	if err := st.CreateNode(&manual); err != nil {
		t.Fatal(err)
	}

	if err := st.DeleteSubscription(first.ID); err != nil {
		t.Fatal(err)
	}
	if nodes, err := st.ListNodes(model.NodeFilter{SourceID: first.ID}); err != nil || len(nodes) != 0 {
		t.Fatalf("deleted subscription nodes=%#v err=%v, want none", nodes, err)
	}
	if nodes, err := st.ListNodes(model.NodeFilter{SourceID: second.ID}); err != nil || len(nodes) != 1 {
		t.Fatalf("other subscription nodes=%#v err=%v, want one", nodes, err)
	}
	if nodes, err := st.ListNodes(model.NodeFilter{Source: "manual"}); err != nil || len(nodes) != 1 {
		t.Fatalf("manual nodes=%#v err=%v, want one", nodes, err)
	}
	if _, err := st.GetSubscription(first.ID); err == nil {
		t.Fatal("deleted subscription still exists")
	}
}
