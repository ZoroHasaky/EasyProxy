package service

import (
	"net"
	"testing"
)

// detectLANIP 必须返回私网 IPv4：mihomo TUN 的 auto-route 会把默认路由指向 Meta
// 接口，历史实现（UDP 拨号选路）在 TUN 运行期间会返回 fake-ip 网关 198.18.0.1，
// 导致 DNS 监听写到客户端不可达的地址。此处断言永不回退到该行为。
func TestDetectLANIPNotFakeIPGateway(t *testing.T) {
	ip := detectLANIP()
	if ip == "" {
		t.Skip("当前环境无可用私网 IPv4（如最小化 CI 容器），跳过")
	}
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.To4() == nil {
		t.Fatalf("detectLANIP 应返回 IPv4，got %q", ip)
	}
	if !parsed.IsPrivate() {
		t.Fatalf("detectLANIP 应返回私网地址，got %q", ip)
	}
	if parsed.Equal(net.ParseIP("198.18.0.1")) {
		t.Fatal("detectLANIP 返回了 TUN fake-ip 网关地址 198.18.0.1")
	}
}
