package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"easyproxy/internal/core"
	"easyproxy/internal/model"
	"easyproxy/internal/parser"
	"easyproxy/internal/store"
)

// NormalizeProxy 将 clash proxy 映射规范化为节点模型
func NormalizeProxy(raw map[string]any) (*model.Node, error) {
	name := toStr(raw["name"])
	server := toStr(raw["server"])
	port := toIntAny(raw["port"])
	typ := toStr(raw["type"])
	if typ == "" || server == "" || port == 0 {
		return nil, fmt.Errorf("代理缺少 type/server/port 字段")
	}
	if name == "" {
		name = server
		raw["name"] = name
	}
	return &model.Node{
		Name:      name,
		Type:      typ,
		Server:    server,
		Port:      port,
		Region:    parser.ParseRegion(name),
		RawConfig: raw,
		DedupHash: HashProxy(raw),
		Enabled:   true,
	}, nil
}

// HashProxy 对除 name 外的全部字段做稳定哈希（map 序列化按键排序，输出确定）
func HashProxy(m map[string]any) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		if k == "name" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var sb strings.Builder
	for _, k := range keys {
		sb.WriteString(k)
		sb.WriteByte('=')
		fmt.Fprintf(&sb, "%v", m[k])
		sb.WriteByte(';')
	}
	sum := sha256.Sum256([]byte(sb.String()))
	return hex.EncodeToString(sum[:16])
}

func toStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func toIntAny(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case string:
		n := 0
		for _, c := range x {
			if c < '0' || c > '9' {
				return n
			}
			n = n*10 + int(c-'0')
		}
		return n
	}
	return 0
}

// FetchSubscription 抓取订阅内容；proxyAddr 非空时经 mihomo 混合端口请求
func FetchSubscription(rawURL, ua, proxyAddr string) (content, userInfo string, err error) {
	transport := http.DefaultTransport
	if proxyAddr != "" {
		proxyURL, perr := url.Parse("http://" + proxyAddr)
		if perr == nil {
			transport = &http.Transport{Proxy: http.ProxyURL(proxyURL)}
		}
	}
	hc := &http.Client{Timeout: 45 * time.Second, Transport: transport}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return "", "", err
	}
	if ua == "" {
		ua = "clash.meta/1.19.0 EasyProxy"
	}
	req.Header.Set("User-Agent", ua)
	resp, err := hc.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("订阅服务器返回 HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return "", "", err
	}
	return string(body), resp.Header.Get("subscription-userinfo"), nil
}

// FetchSubscriptionAuto 自动回退抓取：先按首选路径请求，失败且另一路径可用时换路径重试；
// 两条路径都失败时返回合并错误，便于定位网络问题
func FetchSubscriptionAuto(rawURL, ua string, preferProxy bool, proxyAddr string) (content, userInfo string, err error) {
	if proxyAddr == "" { // 内核未运行，无备用路径，只能直连
		content, userInfo, err = FetchSubscription(rawURL, ua, "")
		if err != nil {
			return "", "", fmt.Errorf("直连失败: %w", err)
		}
		return content, userInfo, nil
	}
	firstProxy, secondProxy := proxyAddr, ""
	firstLabel, secondLabel := "经代理", "直连"
	if !preferProxy {
		firstProxy, secondProxy = "", proxyAddr
		firstLabel, secondLabel = "直连", "经代理"
	}
	content, userInfo, err = FetchSubscription(rawURL, ua, firstProxy)
	if err == nil {
		return content, userInfo, nil
	}
	c2, u2, err2 := FetchSubscription(rawURL, ua, secondProxy)
	if err2 == nil {
		return c2, u2, nil
	}
	return "", "", fmt.Errorf("%s失败: %v；%s失败: %v", firstLabel, err, secondLabel, err2)
}

// SyncSubscription 抓取并同步单个订阅的节点；proxyAddr 非空（内核运行中）时支持直连/代理自动回退
func SyncSubscription(st *store.Store, sub *model.Subscription, proxyAddr string) (added, removed int, err error) {
	content, userInfo, err := FetchSubscriptionAuto(sub.URL, sub.UserAgent, sub.ViaProxy, proxyAddr)
	if err != nil {
		return 0, 0, err
	}
	proxies, err := parser.ParseSubscriptionContent(content)
	if err != nil {
		return 0, 0, err
	}
	nodes := make([]model.Node, 0, len(proxies))
	for _, raw := range proxies {
		n, err := NormalizeProxy(raw)
		if err != nil {
			continue
		}
		n.SourceType = "sub"
		n.SourceID = sub.ID
		nodes = append(nodes, *n)
	}
	added, removed, err = st.SyncSubscriptionNodes(sub.ID, nodes)
	if err != nil {
		return added, removed, err
	}
	_ = st.TouchSubscription(sub.ID, len(nodes), userInfo)
	return added, removed, nil
}

// ImportNodes 手动导入节点（分享链接 / Clash YAML / Base64 均可）
func ImportNodes(st *store.Store, content string) (added, duplicated int, err error) {
	proxies, err := parser.ParseSubscriptionContent(content)
	if err != nil {
		return 0, 0, err
	}
	for _, raw := range proxies {
		n, nerr := NormalizeProxy(raw)
		if nerr != nil {
			continue
		}
		exists, _ := st.NodeHashExists(n.DedupHash)
		if exists {
			duplicated++
			continue
		}
		n.Name = st.UniqueNodeName(n.Name)
		n.RawConfig["name"] = n.Name
		n.SourceType = "manual"
		if err := st.CreateNode(n); err != nil {
			continue
		}
		added++
	}
	if added == 0 && duplicated == 0 {
		return 0, 0, fmt.Errorf("未解析到有效节点")
	}
	return added, duplicated, nil
}

// CheckLatencies 经 mihomo 对 AUTO 组整组测速并回写节点表
func CheckLatencies(st *store.Store, client *core.Client) (int, error) {
	res, err := client.DelayGroup(GroupAUTO, DefaultTestURL, 5000)
	if err != nil {
		return 0, fmt.Errorf("测速失败（需内核运行中且已有启用节点）: %w", err)
	}
	latencies := make(map[string]int, len(res))
	for name, ms := range res {
		latencies[name] = int(ms)
	}
	// 未出现在结果中的启用节点视为失活
	nodes, _ := st.ListEnabledNodes()
	for _, n := range nodes {
		if _, ok := latencies[n.Name]; !ok {
			latencies[n.Name] = 0
		}
	}
	return st.UpdateNodeLatencies(latencies)
}
