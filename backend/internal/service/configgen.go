package service

import (
	"fmt"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

const (
	GroupPROXY    = "PROXY"
	GroupAUTO     = "AUTO"
	DefaultTestURL = "https://www.gstatic.com/generate_204"
)

type GenResult struct {
	YAML       string `json:"yaml"`
	NodeCount  int    `json:"node_count"`
	GroupCount int    `json:"group_count"`
	RuleCount  int    `json:"rule_count"`
}

func defaultGeoxURLs() map[string]string {
	return DefaultGeoxURLs()
}

// DefaultGeoxURLs 导出默认 GeoIP/GeoSite 数据源，供设置接口展示与恢复默认
func DefaultGeoxURLs() map[string]string {
	return map[string]string{
		"geoip":         "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat",
		"geoip.metadb":  "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.metadb",
		"geosite":       "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat",
		"mmdb":          "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb",
		"asn":           "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/GeoLite2-ASN.mmdb",
	}
}

func defaultNameservers() []string {
	return DefaultNameservers()
}

// DefaultNameservers 导出默认主 nameserver 列表
func DefaultNameservers() []string {
	return []string{"https://223.5.5.5/dns-query", "https://doh.pub/dns-query"}
}

func defaultFallbackDNS() []string {
	return DefaultFallbackDNS()
}

// DefaultFallbackDNS 导出默认 fallback DNS 列表
// 用国内 UDP：境外 DoH（1.1.1.1/8.8.8.8）直连被墙时 fallback 永远无应答，
// 会导致所有境外域名解析失败（fake-ip+sniffer 场景下本地境外解析本就少用）
func DefaultFallbackDNS() []string {
	return []string{"223.5.5.5", "119.29.29.29"}
}

// detectLANIP 返回默认出站接口的本机 IP（UDP 拨号选路，不实际发包）
func detectLANIP() string {
	conn, err := net.Dial("udp", "223.5.5.5:53")
	if err != nil {
		return ""
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

// GenerateConfig 依据节点池/策略组/规则模板/设置生成最终 mihomo 配置
func GenerateConfig(st *store.Store) (*GenResult, error) {
	nodes, err := st.ListEnabledNodes()
	if err != nil {
		return nil, err
	}
	// 全局去重（跨订阅）
	seenHash := map[string]bool{}
	deduped := make([]model.Node, 0, len(nodes))
	for _, n := range nodes {
		if n.DedupHash == "" || seenHash[n.DedupHash] {
			continue
		}
		seenHash[n.DedupHash] = true
		deduped = append(deduped, n)
	}

	groups, err := st.ListGroups()
	if err != nil {
		return nil, err
	}

	var sb strings.Builder
	sb.WriteString("# 由 EasyProxy 自动生成，手动修改会被覆盖\n\n")

	mixedPort := st.GetSettingInt("mixed_port", 7890)
	allowLan := st.GetSettingBool("allow_lan", true)
	logLevel := st.GetSetting("log_level", "info")
	fmt.Fprintf(&sb, "mixed-port: %d\nallow-lan: %t\nbind-address: '*'\nmode: rule\nlog-level: %s\nipv6: true\n\n",
		mixedPort, allowLan, logLevel)

	controllerPort := st.GetSettingInt("controller_port", 9095)
	secret := st.GetSetting("controller_secret", "")
	fmt.Fprintf(&sb, "external-controller: 127.0.0.1:%d\nsecret: %s\n\n", controllerPort, quote(secret))

	geox := map[string]string{}
	if !st.GetSettingJSON("geox_urls", &geox) || len(geox) == 0 {
		geox = defaultGeoxURLs()
	}
	sb.WriteString("geox-url:\n")
	for _, k := range sortedKeys(geox) {
		fmt.Fprintf(&sb, "  %s: %s\n", k, quote(geox[k]))
	}
	sb.WriteString("\n")

	tunEnable := st.GetSettingBool("tun_enable", false)
	tunStack := st.GetSetting("tun_stack", "mixed")
	sb.WriteString("tun:\n")
	fmt.Fprintf(&sb, "  enable: %t\n  stack: %s\n  auto-route: true\n  auto-redirect: true\n", tunEnable, tunStack)
	sb.WriteString("  auto-detect-interface: true\n  strict-route: true\n  dns-hijack:\n    - any:53\n    - tcp://any:53\n\n")

	// 嗅探流量还原域名：透明代理下客户端 DNS 常绕过劫持拿到真实 IP，
	// 连接进 TUN 时只有裸 IP，经 CDN/ingress 类节点转发会被重置；开启 sniffer 后按 SNI/Host 还原域名
	sb.WriteString("sniffer:\n")
	sb.WriteString("  enable: true\n  override-destination: true\n  sniff:\n")
	sb.WriteString("    TLS:\n      ports: [443, 8443]\n")
	sb.WriteString("    QUIC:\n      ports: [443, 8443]\n")
	sb.WriteString("    HTTP:\n      ports: [80, 8080-8880]\n      override-destination: true\n")
	sb.WriteString("\n")

	dnsEnable := st.GetSettingBool("dns_enable", true)
	dnsMode := st.GetSetting("dns_mode", "fake-ip")
	ns := []string{}
	if !st.GetSettingJSON("dns_nameserver", &ns) || len(ns) == 0 {
		ns = defaultNameservers()
	}
	fallback := []string{}
	if !st.GetSettingJSON("dns_fallback", &fallback) {
		fallback = defaultFallbackDNS()
	}
	// 透明代理模式下 DNS 直接监听局域网 IP 的 53 端口：局域网设备把 DNS 指向本机即可用；
	// 绑定具体 IP 而非 0.0.0.0，避免与 systemd-resolved 的 127.0.0.53:53 冲突
	dnsListen := "0.0.0.0:1053"
	if dnsEnable && tunEnable {
		if ip := detectLANIP(); ip != "" {
			dnsListen = ip + ":53"
		}
	}
	sb.WriteString("dns:\n")
	fmt.Fprintf(&sb, "  enable: %t\n  listen: %s\n  enhanced-mode: %s\n", dnsEnable, dnsListen, dnsMode)
	if dnsMode == "fake-ip" {
		sb.WriteString("  fake-ip-range: 198.18.0.1/16\n  fake-ip-filter:\n    - '*.lan'\n    - '+.local'\n")
	}
	sb.WriteString("  default-nameserver:\n")
	for _, s := range []string{"223.5.5.5", "119.29.29.29"} {
		fmt.Fprintf(&sb, "    - %s\n", quote(s))
	}
	// 节点服务器域名走国内 UDP 直查，绕过 fallback 门控：否则境外节点域名
	// 解析会被失联的 fallback DoH 卡死，新节点拨号全部超时
	sb.WriteString("  proxy-server-nameserver:\n")
	for _, s := range []string{"223.5.5.5", "119.29.29.29"} {
		fmt.Fprintf(&sb, "    - %s\n", quote(s))
	}
	sb.WriteString("  nameserver:\n")
	for _, s := range ns {
		fmt.Fprintf(&sb, "    - %s\n", quote(s))
	}
	sb.WriteString("  fallback:\n")
	for _, s := range fallback {
		fmt.Fprintf(&sb, "    - %s\n", quote(s))
	}
	sb.WriteString("\n")

	nodeNames := make([]string, 0, len(deduped))
	if len(deduped) > 0 {
		sb.WriteString("proxies:\n")
		for _, n := range deduped {
			rc := make(map[string]any, len(n.RawConfig))
			for k, v := range n.RawConfig {
				rc[k] = v
			}
			rc["name"] = n.Name
			sb.WriteString(marshalItem(rc))
			nodeNames = append(nodeNames, n.Name)
		}
		sb.WriteString("\n")

		sb.WriteString("proxy-groups:\n")
		proxyMembers := []string{GroupAUTO}
		for _, g := range groups {
			if g.Enabled {
				proxyMembers = append(proxyMembers, g.Name)
			}
		}
		proxyMembers = append(proxyMembers, nodeNames...)
		sb.WriteString(marshalItem(map[string]any{
			"name": GroupPROXY, "type": "select", "proxies": proxyMembers, "icon": "🚀",
		}))
		sb.WriteString(marshalItem(map[string]any{
			"name": GroupAUTO, "type": "url-test", "url": DefaultTestURL,
			"interval": 300, "tolerance": 50, "proxies": nodeNames, "icon": "⚡", "lazy": true,
		}))
		for _, g := range groups {
			if !g.Enabled {
				continue
			}
			members := groupMembers(g, deduped)
			if len(members) == 0 {
				members = []string{"DIRECT"}
			}
			sb.WriteString(marshalItem(buildGroupMap(g, members)))
		}
		sb.WriteString("\n")
	}

	tpl, err := st.GetActiveTemplate()
	if err != nil {
		return nil, err
	}
	var rules []model.Rule
	var providers []model.RuleProvider
	if tpl != nil {
		if rules, err = st.ListRules(tpl.ID); err != nil {
			return nil, err
		}
		if providers, err = st.ListRuleProviders(tpl.ID); err != nil {
			return nil, err
		}
	}

	if len(providers) > 0 && len(deduped) > 0 {
		sb.WriteString("rule-providers:\n")
		for _, p := range providers {
			if p.URL == "" {
				continue
			}
			fmt.Fprintf(&sb, "  %s:\n    type: http\n    behavior: %s\n    format: %s\n    url: %s\n    interval: %d\n    path: %s\n",
				p.Name, p.Behavior, p.Format, quote(p.URL), p.Interval, quote("./ruleset/"+sanitizeFilename(p.Name)+".yaml"))
		}
		sb.WriteString("\n")
	}

	sb.WriteString("rules:\n")
	validGroups := map[string]bool{GroupPROXY: true, GroupAUTO: true}
	for _, g := range groups {
		validGroups[g.Name] = true
	}
	ruleCount := 0
	hasMatch := false
	// TUN 模式下必须保证局域网/本机回环直连，否则 MATCH 兜底会把 SSH/面板等
	// 内网流量也丢给代理，导致宿主机失联；即使模板为空也要先注入这些安全规则
	if tunEnable {
		for _, r := range []string{
			"IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
			"IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
			"IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
			"IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
			"IP-CIDR,169.254.0.0/16,DIRECT,no-resolve",
			"IP-CIDR,224.0.0.0/4,DIRECT,no-resolve",
			"IP-CIDR,::1/128,DIRECT,no-resolve",
			"IP-CIDR,fe80::/10,DIRECT,no-resolve",
		} {
			sb.WriteString("  - " + quote(r) + "\n")
			ruleCount++
		}
	}
	for _, r := range rules {
		if !r.Enabled || r.Kind == "" {
			continue
		}
		kind := strings.ToUpper(r.Kind)
		target := r.Target
		if len(deduped) == 0 {
			target = model.BuiltinDirect
		} else if !model.IsBuiltinTarget(target) && !validGroups[target] {
			target = GroupPROXY
		}
		parts := []string{kind}
		if kind != "MATCH" && r.Value != "" {
			parts = append(parts, r.Value)
		}
		parts = append(parts, target)
		if r.NoResolve {
			parts = append(parts, "no-resolve")
		}
		sb.WriteString("  - " + quote(strings.Join(parts, ",")) + "\n")
		ruleCount++
		if kind == "MATCH" {
			hasMatch = true
		}
	}
	if !hasMatch {
		finalTarget := GroupPROXY
		if len(deduped) == 0 {
			finalTarget = model.BuiltinDirect
		}
		// 兜底前先放行国内直连：无模板时全走代理会让国内站点（bilibili 等）异常
		if len(deduped) > 0 {
			sb.WriteString("  - " + quote("GEOIP,CN,DIRECT") + "\n")
			ruleCount++
		}
		sb.WriteString("  - " + quote("MATCH,"+finalTarget) + "\n")
		ruleCount++
	}

	return &GenResult{
		YAML:       sb.String(),
		NodeCount:  len(deduped),
		GroupCount: len(groups) + 2,
		RuleCount:  ruleCount,
	}, nil
}

// marshalItem 将单个 proxy/group 映射序列化为 "  - key: ..." 列表项
func marshalItem(m map[string]any) string {
	b, err := yaml.Marshal(m)
	if err != nil {
		return ""
	}
	s := strings.TrimRight(string(b), "\n")
	lines := strings.Split(s, "\n")
	var sb strings.Builder
	for i, ln := range lines {
		if i == 0 {
			sb.WriteString("  - " + ln + "\n")
		} else {
			sb.WriteString("    " + ln + "\n")
		}
	}
	return sb.String()
}

func buildGroupMap(g model.Group, members []string) map[string]any {
	m := map[string]any{"name": g.Name, "type": g.Type, "proxies": members}
	if g.Icon != "" {
		m["icon"] = g.Icon
	}
	switch g.Type {
	case "url-test", "fallback", "load-balance":
		u := g.TestURL
		if u == "" {
			u = DefaultTestURL
		}
		m["url"] = u
		iv := g.Interval
		if iv <= 0 {
			iv = 300
		}
		m["interval"] = iv
		m["lazy"] = true
		if g.Type == "url-test" && g.Tolerance > 0 {
			m["tolerance"] = g.Tolerance
		}
	}
	return m
}

func groupMembers(g model.Group, nodes []model.Node) []string {
	var out []string
	switch {
	case g.Region != "":
		for _, n := range nodes {
			if n.Region == g.Region {
				out = append(out, n.Name)
			}
		}
	case g.IncludeRegex != "":
		re, err := regexp.Compile(g.IncludeRegex)
		if err != nil {
			return nil
		}
		for _, n := range nodes {
			if re.MatchString(n.Name) {
				out = append(out, n.Name)
			}
		}
	default:
		for _, n := range nodes {
			out = append(out, n.Name)
		}
	}
	return out
}

func quote(s string) string { return strconv.Quote(s) }

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

var unsafeFileChars = regexp.MustCompile(`[^a-zA-Z0-9_\-\.]`)

func sanitizeFilename(s string) string {
	s = unsafeFileChars.ReplaceAllString(s, "_")
	if s == "" {
		s = "ruleset"
	}
	return s
}
