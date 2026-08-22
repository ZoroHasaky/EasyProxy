package service

import (
	"testing"
	"time"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

// TestImportNodesNoConnLeak 复现线上卡死：订阅节点已存在时手动导入 vless，
// 若单连接池被泄漏，后续所有 DB 调用将永久阻塞（由 go test -timeout 兜底 dump 堆栈）
func TestImportNodesNoConnLeak(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	// 预置一个订阅及其节点（模拟用户已成功添加订阅的现场）
	sub := &model.Subscription{Name: "lx", URL: "https://example.com/sub", Enabled: true}
	if err := st.CreateSubscription(sub); err != nil {
		t.Fatal(err)
	}
	subNodes := []model.Node{{
		Name: "🇯🇵日本高速01", Type: "vless", Server: "cfyes.example.xyz", Port: 443,
		RawConfig: map[string]any{"name": "🇯🇵日本高速01", "type": "vless", "server": "cfyes.example.xyz", "port": 443},
		DedupHash: "hash-sub-1", SourceType: "sub", SourceID: sub.ID, Enabled: true,
	}}
	if _, _, err := st.SyncSubscriptionNodes(sub.ID, subNodes); err != nil {
		t.Fatal(err)
	}

	// 手动导入一条 vless（与线上操作一致）
	link := "vless://b831381d-6324-4d53-ad4f-8cda2c9ad3a@1.2.3.4:443?encryption=none&security=tls&sni=example.com&fp=chrome&type=ws&host=example.com&path=%2Fws#%F0%9F%87%AF%F0%9F%87%B5%E6%89%8B%E5%8A%A8%E8%8A%82%E7%82%B9"
	added, dup, err := ImportNodes(st, link)
	t.Logf("import: added=%d dup=%d err=%v", added, dup, err)

	// 后续 DB 操作必须在 5 秒内完成，否则视为连接池被卡死
	done := make(chan struct{})
	go func() {
		_ = st.SetSetting("leak_probe", "1")
		_, _, _ = st.SyncSubscriptionNodes(sub.ID, subNodes)
		_ = st.GetSetting("leak_probe", "")
		close(done)
	}()
	select {
	case <-done:
		t.Log("后续 DB 操作正常，无泄漏")
	case <-time.After(5 * time.Second):
		t.Fatal("DB 操作阻塞超过 5 秒：连接池疑似被泄漏（等待 go test 超时 dump 堆栈）")
	}
}
