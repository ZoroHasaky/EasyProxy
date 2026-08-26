package service

import (
	"encoding/json"
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
	GroupPROXY     = "PROXY"
	GroupAUTO      = "AUTO"
	DefaultTestURL = "https://www.gstatic.com/generate_204"
)

type GenResult struct {
	YAML       string `json:"yaml"`
	NodeCount  int    `json:"node_count"`
	GroupCount int    `json:"group_count"`
	RuleCount  int    `json:"rule_count"`
}

// EffectiveNodes 返回最终会写入 mihomo 配置的启用节点，并按协议参数全局去重。
func EffectiveNodes(st *store.Store) ([]model.Node, error) {
	nodes, err := st.ListEnabledNodes()
	if err != nil {
		return nil, err
	}
	seenHash := map[string]bool{}
	deduped := make([]model.Node, 0, len(nodes))
	for _, n := range nodes {
		if n.DedupHash == "" || seenHash[n.DedupHash] {
			continue
		}
		seenHash[n.DedupHash] = true
		deduped = append(deduped, n)
	}
	return deduped, nil
}

// DefaultGeoxSources 导出按优先级排列的推荐 Geo 数据源。
// mihomo 每个分类只接受一个 URL，生成配置时使用每类首个非空地址。
func DefaultGeoxSources() map[string][]string {
	files := map[string]string{
		"geoip":        "geoip.dat",
		"geoip.metadb": "geoip.metadb",
		"geosite":      "geosite.dat",
		"mmdb":         "country.mmdb",
		"asn":          "GeoLite2-ASN.mmdb",
	}
	out := make(map[string][]string, len(files))
	for key, file := range files {
		out[key] = []string{
			"https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/" + file,
			"https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/" + file,
			"https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/release/" + file,
		}
	}
	return out
}

// DefaultGeoxURLs 保留单地址形式，供兼容调用使用。
func DefaultGeoxURLs() map[string]string {
	return activeGeoxURLs(DefaultGeoxSources())
}

// GeoxSources 读取 Geo 数据源，并兼容旧版 map[string]string 存储格式。
func GeoxSources(st *store.Store) map[string][]string {
	return GeoxSourcesFromRaw(st.GetSetting("geox_urls", ""))
}

// GeoxSourcesFromRaw 将保存的 Geo 数据源 JSON 转为实际使用的候选地址列表，
// 并兼容旧版 map[string]string 格式。
func GeoxSourcesFromRaw(raw string) map[string][]string {
	var sources map[string][]string
	if raw != "" && json.Unmarshal([]byte(raw), &sources) == nil && len(sources) > 0 {
		return normalizeGeoxSources(sources)
	}
	var legacy map[string]string
	if raw != "" && json.Unmarshal([]byte(raw), &legacy) == nil && len(legacy) > 0 {
		wrapped := make(map[string][]string, len(legacy))
		for key, value := range legacy {
			wrapped[key] = []string{value}
		}
		return normalizeGeoxSources(wrapped)
	}
	return DefaultGeoxSources()
}

type configSettings struct {
	st     *store.Store
	values map[string]string
}

func (c configSettings) get(key, def string) string {
	if value, ok := c.values[key]; ok {
		return value
	}
	return c.st.GetSetting(key, def)
}

func (c configSettings) getInt(key string, def int) int {
	value := c.get(key, "")
	if value == "" {
		return def
	}
	number, err := strconv.Atoi(value)
	if err != nil {
		return def
	}
	return number
}

func (c configSettings) getBool(key string, def bool) bool {
	switch c.get(key, "") {
	case "1", "true":
		return true
	case "0", "false":
		return false
	default:
		return def
	}
}

func (c configSettings) getJSON(key string, out any) bool {
	return json.Unmarshal([]byte(c.get(key, "")), out) == nil
}

func normalizeGeoxSources(sources map[string][]string) map[string][]string {
	// 始终保留未显式覆盖类型的推荐源。这样旧版本只保存 geoip 一项时，
	// geosite、MMDB 等数据不会因升级后缺失配置而停止更新。
	defaults := DefaultGeoxSources()
	out := make(map[string][]string, len(defaults))
	for key, values := range defaults {
		out[key] = append([]string(nil), values...)
	}
	for key, values := range sources {
		clean := make([]string, 0, len(values))
		for _, value := range values {
			if value = strings.TrimSpace(value); value != "" {
				clean = append(clean, value)
			}
		}
		if len(clean) > 0 {
			out[key] = clean
		}
	}
	return out
}

func activeGeoxURLs(sources map[string][]string) map[string]string {
	out := make(map[string]string, len(sources))
	for key, values := range normalizeGeoxSources(sources) {
		if len(values) > 0 {
			out[key] = values[0]
		}
	}
	return out
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
	return generateConfig(st, configSettings{st: st})
}

// GenerateConfigForSettings 使用给定的设置快照生成目标配置。调用方可用它保证
// “生成、加载、记录为已应用”严格对应同一组设置。
func GenerateConfigForSettings(st *store.Store, values map[string]string) (*GenResult, error) {
	return generateConfig(st, configSettings{st: st, values: values})
}

// GenerateAppliedConfig 使用最近一次成功应用的设置快照生成配置。
// 节点、订阅和规则的即时应用必须调用此函数，避免提前带入顶栏待应用设置。
func GenerateAppliedConfig(st *store.Store) (*GenResult, error) {
	values, err := st.AppliedConfigSettings()
	if err != nil {
		return nil, err
	}
	return GenerateConfigForSettings(st, values)
}

// GenerateClashExport 生成可被 Mihomo/Clash Verge 直接导入的独立路由配置。
// 它只保留节点、节点组合、规则与按需 Geo 数据源，不泄露本机监听、DNS、TUN 或控制器设置。
func GenerateClashExport(st *store.Store) (*GenResult, error) {
	generated, err := GenerateConfig(st)
	if err != nil {
		return nil, err
	}

	var runtime map[string]any
	if err := yaml.Unmarshal([]byte(generated.YAML), &runtime); err != nil {
		return nil, fmt.Errorf("解析生成配置失败: %w", err)
	}

	export := map[string]any{"mode": "rule"}
	for _, key := range []string{"proxies", "proxy-groups", "rule-providers", "rules"} {
		if value, ok := runtime[key]; ok {
			export[key] = value
		}
	}

	needGeoIP, needGeoSite := exportedGeoRuleUsage(runtime["rules"])
	if needGeoIP || needGeoSite {
		if sources, ok := runtime["geox-url"].(map[string]any); ok {
			selected := map[string]any{}
			if needGeoIP {
				if source, exists := sources["geoip"]; exists {
					selected["geoip"] = source
				}
			}
			if needGeoSite {
				if source, exists := sources["geosite"]; exists {
					selected["geosite"] = source
				}
			}
			if len(selected) > 0 {
				export["geodata-mode"] = true
				export["geo-auto-update"] = true
				export["geo-update-interval"] = 24
				export["geox-url"] = selected
			}
		}
	}

	encoded, err := yaml.Marshal(export)
	if err != nil {
		return nil, fmt.Errorf("编码导出配置失败: %w", err)
	}
	generated.YAML = "# 由 EasyProxy 导出，仅包含节点与分流规则\n\n" + string(encoded)
	return generated, nil
}

func exportedGeoRuleUsage(value any) (needGeoIP, needGeoSite bool) {
	rules, ok := value.([]any)
	if !ok {
		return false, false
	}
	for _, value := range rules {
		rule, ok := value.(string)
		if !ok {
			continue
		}
		kind := strings.ToUpper(strings.TrimSpace(strings.SplitN(rule, ",", 2)[0]))
		switch kind {
		case "GEOIP":
			needGeoIP = true
		case "GEOSITE":
			needGeoSite = true
		}
	}
	return needGeoIP, needGeoSite
}

func generateConfig(st *store.Store, settings configSettings) (*GenResult, error) {
	deduped, err := EffectiveNodes(st)
	if err != nil {
		return nil, err
	}

	groups, err := st.ListGroups()
	if err != nil {
		return nil, err
	}

	var sb strings.Builder
	sb.WriteString("# 由 EasyProxy 自动生成，手动修改会被覆盖\n\n")

	mixedPort := settings.getInt("mixed_port", 7890)
	allowLan := settings.getBool("allow_lan", true)
	logLevel := settings.get("log_level", "info")
	fmt.Fprintf(&sb, "mixed-port: %d\nallow-lan: %t\nbind-address: '*'\nmode: rule\nlog-level: %s\nipv6: true\n\n",
		mixedPort, allowLan, logLevel)
	// 保留 select 组的运行时选择，避免 PROXY 在热重载或重启后回到默认项。
	sb.WriteString("profile:\n  store-selected: true\n\n")

	controllerPort := st.GetSettingInt("controller_port", 9095)
	secret := st.GetSetting("controller_secret", "")
	fmt.Fprintf(&sb, "external-controller: 127.0.0.1:%d\nsecret: %s\n\n", controllerPort, quote(secret))

	if settings.getBool("geo_enabled", true) {
		geox := activeGeoxURLs(GeoxSourcesFromRaw(settings.get("geox_urls", "")))
		if len(geox) > 0 {
			sb.WriteString("geox-url:\n")
			for _, k := range sortedKeys(geox) {
				fmt.Fprintf(&sb, "  %s: %s\n", k, quote(geox[k]))
			}
		}
		fmt.Fprintf(&sb, "geo-auto-update: %t\n", settings.getBool("geo_auto_update", false))
		fmt.Fprintf(&sb, "geo-update-interval: %d\n", settings.getInt("geo_update_interval", 24))
		// Geo 数据页管理的是 GeoIP.dat / GeoSite.dat；显式启用 dat 模式，
		// 避免 Mihomo 默认改用 geoip.metadb，导致页面状态和实际路由数据不一致。
		sb.WriteString("geodata-mode: true\n")
		sb.WriteString("\n")
	}

	tunEnable := settings.getBool("tun_enable", false)
	tunStack := settings.get("tun_stack", "mixed")
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

	dnsEnable := settings.getBool("dns_enable", true)
	dnsMode := settings.get("dns_mode", "fake-ip")
	ns := []string{}
	if !settings.getJSON("dns_nameserver", &ns) || len(ns) == 0 {
		ns = defaultNameservers()
	}
	fallback := []string{}
	if !settings.getJSON("dns_fallback", &fallback) {
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

	recognitionRules, err := st.ListRecognitionRules()
	if err != nil {
		return nil, err
	}
	outboundRules, err := st.ListOutboundRules()
	if err != nil {
		return nil, err
	}

	targetResolver := newRuleTargetResolver(deduped, groups)
	outboundByRecognition := make(map[int64]model.OutboundRule, len(outboundRules))
	for _, outbound := range outboundRules {
		outboundByRecognition[outbound.RecognitionID] = outbound
	}
	remoteRecognitionRules := make([]model.RecognitionRule, 0)
	for _, recognition := range recognitionRules {
		if !recognition.Enabled || recognition.SourceURL == "" {
			continue
		}
		outbound, exists := outboundByRecognition[recognition.ID]
		if !exists || !outbound.Enabled {
			continue
		}
		remoteRecognitionRules = append(remoteRecognitionRules, recognition)
	}
	if len(remoteRecognitionRules) > 0 {
		sb.WriteString("rule-providers:\n")
		for _, recognition := range remoteRecognitionRules {
			fmt.Fprintf(&sb, "  %s:\n", quote(recognition.Name))
			sb.WriteString("    type: http\n")
			fmt.Fprintf(&sb, "    behavior: %s\n", recognition.SourceBehavior)
			fmt.Fprintf(&sb, "    url: %s\n", quote(recognition.SourceURL))
			fmt.Fprintf(&sb, "    path: %s\n", quote("./ruleset/recognition-"+strconv.FormatInt(recognition.ID, 10)+".yaml"))
			fmt.Fprintf(&sb, "    interval: %d\n", recognition.SourceInterval)
			sb.WriteString("    format: yaml\n")
		}
		sb.WriteString("\n")
	}

	sb.WriteString("rules:\n")
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
	for _, recognition := range recognitionRules {
		if !recognition.Enabled || recognition.Kind == "" {
			continue
		}
		outbound, exists := outboundByRecognition[recognition.ID]
		if !exists || !outbound.Enabled {
			continue
		}
		kind := strings.ToUpper(recognition.Kind)
		target, builtinTarget := model.BuiltinOutboundTarget(outbound.GroupID)
		if !builtinTarget {
			target = targetResolver.resolve(model.GroupTargetRef(outbound.GroupID))
		}
		if len(deduped) == 0 && (target == GroupPROXY || target == GroupAUTO) {
			target = model.BuiltinDirect
		}
		if recognition.SourceURL != "" {
			parts := []string{"RULE-SET", recognition.Name, target}
			if recognition.SourceBehavior == "ipcidr" {
				parts = append(parts, "no-resolve")
			}
			sb.WriteString("  - " + quote(strings.Join(parts, ",")) + "\n")
			ruleCount++
			continue
		}
		if kind == "MATCH" {
			sb.WriteString("  - " + quote(strings.Join([]string{kind, target}, ",")) + "\n")
			ruleCount++
			hasMatch = true
			continue
		}
		for _, condition := range recognition.Conditions {
			condition = strings.TrimSpace(condition)
			if condition == "" {
				continue
			}
			sb.WriteString("  - " + quote(strings.Join([]string{kind, condition, target}, ",")) + "\n")
			ruleCount++
		}
	}
	if !hasMatch {
		finalTarget := GroupPROXY
		if len(deduped) == 0 {
			finalTarget = model.BuiltinDirect
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
	mode := groupMemberMode(g)
	switch mode {
	case "manual":
		selected := make(map[int64]bool, len(g.NodeIDs))
		for _, id := range g.NodeIDs {
			selected[id] = true
		}
		for _, n := range nodes {
			if selected[n.ID] {
				out = append(out, n.Name)
			}
		}
	case "region":
		for _, n := range nodes {
			if n.Region == g.Region {
				out = append(out, n.Name)
			}
		}
	case "regex":
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

func groupMemberMode(g model.Group) string {
	switch g.MemberMode {
	case "all", "region", "manual", "regex":
		return g.MemberMode
	}
	// 兼容旧数据：旧版以 region / include_regex 是否为空推断成员范围。
	if len(g.NodeIDs) > 0 {
		return "manual"
	}
	if g.Region != "" {
		return "region"
	}
	if g.IncludeRegex != "" {
		return "regex"
	}
	return "all"
}

type ruleTargetResolver struct {
	nodesByID     map[int64]string
	nodeNames     map[string]bool
	groupsByID    map[int64]model.Group
	availableByID map[int64]bool
	groupsByName  map[string]model.Group
}

func newRuleTargetResolver(nodes []model.Node, groups []model.Group) *ruleTargetResolver {
	r := &ruleTargetResolver{
		nodesByID:     map[int64]string{},
		nodeNames:     map[string]bool{},
		groupsByID:    map[int64]model.Group{},
		availableByID: map[int64]bool{},
		groupsByName:  map[string]model.Group{},
	}
	for _, n := range nodes {
		r.nodesByID[n.ID] = n.Name
		r.nodeNames[n.Name] = true
	}
	for _, g := range groups {
		r.groupsByID[g.ID] = g
		r.groupsByName[g.Name] = g
		r.availableByID[g.ID] = g.Enabled && len(groupMembers(g, nodes)) > 0
	}
	return r
}

func (r *ruleTargetResolver) resolve(target string) string {
	if model.IsBuiltinTarget(target) {
		return target
	}
	if kind, id, ok := model.ParseTargetRef(target); ok {
		switch kind {
		case "node":
			if name := r.nodesByID[id]; name != "" {
				return name
			}
		case "group":
			if g, exists := r.groupsByID[id]; exists && r.availableByID[id] {
				return g.Name
			}
		}
		return GroupPROXY
	}
	// 兼容旧数据库、旧备份和外部模板中的节点名或策略组名。
	if r.nodeNames[target] {
		return target
	}
	if g, ok := r.groupsByName[target]; ok && r.availableByID[g.ID] {
		return g.Name
	}
	return GroupPROXY
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
