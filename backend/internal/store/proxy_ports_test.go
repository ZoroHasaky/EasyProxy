package store

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
)

func TestProxyPortsInitializeAndPersistRules(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	ports, err := st.ListProxyPorts()
	if err != nil || len(ports) != 1 || !ports[0].IsDefault || ports[0].Port != 7890 {
		t.Fatalf("default proxy port=%#v err=%v", ports, err)
	}

	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{{
		Name: "测试域名", Kind: "DOMAIN-SUFFIX", Conditions: []string{"example.com"}, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	recognitions, _ := st.ListRecognitionRules()
	if err := st.ReplaceGroups([]model.Group{{Name: "测试组", Type: "select", Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	groups, _ := st.ListGroups()
	if err := st.ReplaceProxyPortRules(ports[0].ID, []model.ProxyPortRule{{
		RecognitionID: recognitions[0].ID, GroupID: groups[0].ID, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateProxyPort(&model.ProxyPort{Name: "备用端口", Port: 7891, Enabled: true, DefaultTarget: "DIRECT"}); err != nil {
		t.Fatal(err)
	}
	ports, err = st.ListProxyPorts()
	if err != nil || len(ports) != 2 || len(ports[0].Rules) != 1 || ports[1].Port != 7891 {
		t.Fatalf("persisted proxy ports=%#v err=%v", ports, err)
	}
	if err := st.CreateProxyPort(&model.ProxyPort{Name: "重复端口", Port: 7891, Enabled: true}); err == nil || !strings.Contains(err.Error(), "已存在") {
		t.Fatalf("duplicate port should fail, got %v", err)
	}
	if err := st.DeleteProxyPort(ports[0].ID); err == nil || !strings.Contains(err.Error(), "不能删除") {
		t.Fatalf("default port deletion should fail, got %v", err)
	}
	if err := st.UpdateDefaultProxyPort(7892); err != nil {
		t.Fatal(err)
	}
	if got := st.GetSettingInt("mixed_port", 0); got != 7892 {
		t.Fatalf("mixed_port=%d, want 7892", got)
	}
}

func TestProxyPortsRejectReservedPortsAndSupportNodeTargets(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	for _, tc := range []struct {
		name string
		port int
		want string
	}{
		{"panel", 8080, "面板"},
		{"controller", 9095, "控制器"},
		{"dns", 53, "DNS"},
		{"dns proxy", 1053, "DNS"},
	} {
		err := st.CreateProxyPort(&model.ProxyPort{Name: tc.name, Port: tc.port, Enabled: true})
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("port %d should be rejected with %q, got %v", tc.port, tc.want, err)
		}
	}

	if err := st.CreateNode(&model.Node{Name: "独立节点", Type: "socks5", Server: "127.0.0.1", Port: 10001, Enabled: true, RawConfig: map[string]any{
		"name": "独立节点", "type": "socks5", "server": "127.0.0.1", "port": 10001,
	}}); err != nil {
		t.Fatal(err)
	}
	nodes, err := st.ListNodes(model.NodeFilter{})
	if err != nil || len(nodes) != 1 {
		t.Fatalf("nodes=%#v err=%v", nodes, err)
	}
	recognitions, err := st.ListRecognitionRules()
	if err != nil || len(recognitions) != 0 {
		t.Fatalf("recognitions=%#v err=%v", recognitions, err)
	}
	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{{Name: "节点目标规则", Kind: "DOMAIN", Conditions: []string{"node.example"}, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	recognitions, _ = st.ListRecognitionRules()
	ports, _ := st.ListProxyPorts()
	if err := st.ReplaceProxyPortRules(ports[0].ID, []model.ProxyPortRule{{
		RecognitionID: recognitions[0].ID, Target: model.NodeTargetRef(nodes[0].ID), Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	ports, err = st.ListProxyPorts()
	if err != nil || len(ports[0].Rules) != 1 || ports[0].Rules[0].Target != model.NodeTargetRef(nodes[0].ID) {
		t.Fatalf("node target rule=%#v err=%v", ports[0].Rules, err)
	}
	if err := st.DeleteNode(nodes[0].ID); err == nil || !strings.Contains(err.Error(), "端口分流规则") {
		t.Fatalf("referenced node should not be deletable, got %v", err)
	}
}

func TestProxyPortRulesAreReturnedByRecognitionPriority(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{
		{Name: "低优先级", Kind: "DOMAIN", Conditions: []string{"low.example"}, Priority: 1, Enabled: true},
		{Name: "高优先级", Kind: "DOMAIN", Conditions: []string{"high.example"}, Priority: 99, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	recognitions, _ := st.ListRecognitionRules()
	ports, _ := st.ListProxyPorts()
	if err := st.ReplaceProxyPortRules(ports[0].ID, []model.ProxyPortRule{
		{RecognitionID: recognitions[0].ID, GroupID: model.OutboundTargetDirectID, Enabled: true},
		{RecognitionID: recognitions[1].ID, GroupID: model.OutboundTargetRejectID, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	ports, err = st.ListProxyPorts()
	if err != nil || len(ports[0].Rules) != 2 || ports[0].Rules[0].RecognitionID != recognitions[0].ID {
		t.Fatalf("priority order=%#v err=%v", ports[0].Rules, err)
	}
}
