package service

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

// TestConcurrentStoreOps 并发模拟线上交错：导入/订阅同步/列表查询/设置读写并发跑，
// 单连接池下若出现卡死，go test -timeout 会 dump 堆栈定位持有者
func TestConcurrentStoreOps(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	sub := &model.Subscription{Name: "lx", URL: "https://example.com/sub", Enabled: true, UpdateInterval: 1}
	if err := st.CreateSubscription(sub); err != nil {
		t.Fatal(err)
	}
	subNodes := []model.Node{{
		Name: "🇯🇵日本高速01", Type: "vless", Server: "a.example.xyz", Port: 443,
		RawConfig: map[string]any{"name": "🇯🇵日本高速01"}, DedupHash: "h1", SourceType: "sub", SourceID: sub.ID, Enabled: true,
	}}
	if _, _, err := st.SyncSubscriptionNodes(sub.ID, subNodes); err != nil {
		t.Fatal(err)
	}

	stop := make(chan struct{})
	var wg sync.WaitGroup
	probe := func(name string, fn func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
                done := make(chan struct{})
                go func() { fn(); close(done) }()
                select {
                case <-done:
                case <-time.After(10 * time.Second):
                    // 阈值需大于 busy_timeout(5s)：并发写串行等待是正常的，
                    // 这里只捕获连接泄漏导致的永久阻塞
                    t.Errorf("操作 %s 阻塞超过 10 秒（连接池被占死）", name)
                    return
                }
			}
		}()
	}

	link := "vless://b831381d-6324-4d53-ad4f-8cda2c9ad3a@1.2.3.4:443?encryption=none&security=tls&type=ws&path=/ws#手动节点"
	probe("import", func() { _, _, _ = ImportNodes(st, link) })
	probe("sync-sub", func() { _, _, _ = st.SyncSubscriptionNodes(sub.ID, subNodes) })
	probe("list-nodes", func() { _, _ = st.ListNodes(model.NodeFilter{Enabled: "true"}) })
	probe("get-setting", func() { _ = st.GetSettingBool("must_change_password", false) })
	probe("gen-config", func() { _, _ = GenerateConfig(st) })
	probe("set-setting", func() { _ = st.SetSetting("k", fmt.Sprint(time.Now().UnixNano())) })

	time.Sleep(5 * time.Second)
	close(stop)
	wg.Wait()
}
