package parser

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// ParseShareLinks 解析多行分享链接文本，返回 clash proxy 列表与失败行
func ParseShareLinks(text string) (proxies []map[string]any, errs []string) {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") {
			continue
		}
		// 容错：yaml 列表项残留
		line = strings.TrimPrefix(line, "- ")
		p, err := ParseShareLink(line)
		if err != nil {
			errs = append(errs, line+": "+err.Error())
			continue
		}
		proxies = append(proxies, p)
	}
	return
}

// ParseShareLink 解析单条分享链接为 clash/mihomo proxy 映射
func ParseShareLink(link string) (map[string]any, error) {
	switch {
	case strings.HasPrefix(link, "ss://"):
		return parseSS(strings.TrimPrefix(link, "ss://"))
	case strings.HasPrefix(link, "vmess://"):
		return parseVmess(strings.TrimPrefix(link, "vmess://"))
	case strings.HasPrefix(link, "vless://"):
		return parseVless(link)
	case strings.HasPrefix(link, "trojan://"):
		return parseTrojan(link)
	case strings.HasPrefix(link, "hysteria2://"), strings.HasPrefix(link, "hy2://"):
		return parseHysteria2(link)
	case strings.HasPrefix(link, "tuic://"):
		return parseTuic(link)
	}
	return nil, fmt.Errorf("不支持的链接协议")
}

func b64decode(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if strings.ContainsAny(s, "-_") {
		s = strings.NewReplacer("-", "+", "_", "/").Replace(s)
	}
	switch len(s) % 4 {
	case 2:
		s += "=="
	case 3:
		s += "="
	}
	return base64.StdEncoding.DecodeString(s)
}

func toInt(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case string:
		n, _ := strconv.Atoi(x)
		return n
	}
	return 0
}

func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// ---------- ss ----------

func parseSS(rest string) (map[string]any, error) {
	name := ""
	if i := strings.IndexByte(rest, '#'); i >= 0 {
		name, _ = url.QueryUnescape(rest[i+1:])
		rest = rest[:i]
	}
	query := ""
	if i := strings.IndexByte(rest, '?'); i >= 0 {
		query = rest[i+1:]
		rest = rest[:i]
	}
	var method, password, hostport string
	if i := strings.LastIndexByte(rest, '@'); i >= 0 {
		userinfo := rest[:i]
		hostport = rest[i+1:]
		decoded := false
		if raw, err := b64decode(userinfo); err == nil {
			if s := string(raw); strings.Contains(s, ":") && isPrintableASCII(s) {
				parts := strings.SplitN(s, ":", 2)
				method, password, decoded = parts[0], parts[1], true
			}
		}
		if !decoded {
			dec, err := url.QueryUnescape(userinfo)
			if err != nil {
				dec = userinfo
			}
			parts := strings.SplitN(dec, ":", 2)
			if len(parts) != 2 {
				return nil, fmt.Errorf("ss 用户信息解析失败")
			}
			method, password = parts[0], parts[1]
		}
	} else {
		raw, err := b64decode(rest)
		if err != nil {
			return nil, fmt.Errorf("ss base64 解析失败")
		}
		s := string(raw)
		i := strings.LastIndexByte(s, '@')
		if i < 0 {
			return nil, fmt.Errorf("ss 链接缺少服务器信息")
		}
		parts := strings.SplitN(s[:i], ":", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("ss 加密方式解析失败")
		}
		method, password, hostport = parts[0], parts[1], s[i+1:]
	}
	host, portStr, err := net.SplitHostPort(hostport)
	if err != nil {
		return nil, fmt.Errorf("ss 服务器地址无效: %s", hostport)
	}
	if name == "" {
		name = host
	}
	m := map[string]any{
		"name": name, "type": "ss", "server": host, "port": toInt(portStr),
		"cipher": method, "password": password, "udp": true,
	}
	if q, err := url.ParseQuery(query); err == nil && q.Get("plugin") != "" {
		applySSPlugin(m, q.Get("plugin"))
	}
	return m, nil
}

func isPrintableASCII(s string) bool {
	for _, r := range s {
		if r < 0x20 || r > 0x7e {
			return false
		}
	}
	return true
}

func applySSPlugin(m map[string]any, plugin string) {
	segs := strings.Split(plugin, ";")
	opts := map[string]any{}
	for _, kv := range segs[1:] {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) == 2 {
			opts[parts[0]] = parts[1]
		}
	}
	switch segs[0] {
	case "obfs-local":
		m["plugin"] = "obfs"
		o := map[string]any{}
		if v, ok := opts["obfs"]; ok {
			o["mode"] = v
		}
		if v, ok := opts["obfs-host"]; ok {
			o["host"] = v
		}
		m["plugin-opts"] = o
	case "v2ray-plugin":
		m["plugin"] = "v2ray-plugin"
		o := map[string]any{}
		if v, ok := opts["mode"]; ok {
			o["mode"] = v
		}
		if v, ok := opts["host"]; ok {
			o["host"] = v
		}
		if v, ok := opts["path"]; ok {
			o["path"] = v
		}
		if _, ok := opts["tls"]; ok {
			o["tls"] = true
		}
		m["plugin-opts"] = o
	}
}

// ---------- vmess ----------

func parseVmess(rest string) (map[string]any, error) {
	raw, err := b64decode(rest)
	if err != nil {
		return nil, fmt.Errorf("vmess base64 解析失败")
	}
	var v map[string]any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("vmess JSON 解析失败")
	}
	host := str(v["add"])
	if host == "" {
		return nil, fmt.Errorf("vmess 缺少服务器地址")
	}
	port := toInt(v["port"])
	name := str(v["ps"])
	if name == "" {
		name = host
	}
	cipher := str(v["scy"])
	if cipher == "" {
		cipher = "auto"
	}
	m := map[string]any{
		"name": name, "type": "vmess", "server": host, "port": port,
		"uuid": str(v["id"]), "alterId": toInt(v["aid"]), "cipher": cipher, "udp": true,
	}
	applyNetworkOpts(m, str(v["net"]), str(v["host"]), str(v["path"]), str(v["type"]))
	if str(v["tls"]) == "tls" {
		m["tls"] = true
		if sni := str(v["sni"]); sni != "" {
			m["servername"] = sni
		}
	}
	if alpn := str(v["alpn"]); alpn != "" {
		m["alpn"] = strings.Split(alpn, ",")
	}
	if fp := str(v["fp"]); fp != "" {
		m["client-fingerprint"] = fp
	}
	return m, nil
}

// ---------- vless / trojan / hysteria2 / tuic (URI 形式) ----------

func parseVless(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("vless 链接无效")
	}
	q := u.Query()
	name := u.Fragment
	if name == "" {
		name = u.Hostname()
	}
	m := map[string]any{
		"name": name, "type": "vless", "server": u.Hostname(), "port": toInt(u.Port()),
		"uuid": u.User.Username(), "udp": true,
	}
	security := q.Get("security")
	if security == "tls" || security == "reality" {
		m["tls"] = true
		if sni := q.Get("sni"); sni != "" {
			m["servername"] = sni
		}
	}
	if security == "reality" {
		ro := map[string]any{}
		if pbk := q.Get("pbk"); pbk != "" {
			ro["public-key"] = pbk
		}
		if sid := q.Get("sid"); sid != "" {
			ro["short-id"] = sid
		}
		m["reality-opts"] = ro
	}
	if flow := q.Get("flow"); flow != "" {
		m["flow"] = flow
	}
	if fp := q.Get("fp"); fp != "" {
		m["client-fingerprint"] = fp
	}
	applyNetworkOpts(m, q.Get("type"), q.Get("host"), q.Get("path"), q.Get("headerType"))
	if alpn := q.Get("alpn"); alpn != "" {
		m["alpn"] = strings.Split(alpn, ",")
	}
	return m, nil
}

func parseTrojan(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil || u.Host == "" || u.User == nil {
		return nil, fmt.Errorf("trojan 链接无效")
	}
	q := u.Query()
	name := u.Fragment
	if name == "" {
		name = u.Hostname()
	}
	m := map[string]any{
		"name": name, "type": "trojan", "server": u.Hostname(), "port": toInt(u.Port()),
		"password": u.User.Username(), "udp": true,
	}
	if sni := q.Get("sni"); sni != "" {
		m["servername"] = sni
	}
	if sni := q.Get("peer"); sni != "" && m["servername"] == nil {
		m["servername"] = sni
	}
	if alpn := q.Get("alpn"); alpn != "" {
		m["alpn"] = strings.Split(alpn, ",")
	}
	if q.Get("allowInsecure") == "1" || q.Get("insecure") == "1" {
		m["skip-cert-verify"] = true
	}
	applyNetworkOpts(m, q.Get("type"), q.Get("host"), q.Get("path"), "")
	return m, nil
}

func parseHysteria2(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil || u.Host == "" || u.User == nil {
		return nil, fmt.Errorf("hysteria2 链接无效")
	}
	q := u.Query()
	name := u.Fragment
	if name == "" {
		name = u.Hostname()
	}
	m := map[string]any{
		"name": name, "type": "hysteria2", "server": u.Hostname(), "port": toInt(u.Port()),
		"password": u.User.Username(),
	}
	if sni := q.Get("sni"); sni != "" {
		m["sni"] = sni
	}
	if q.Get("insecure") == "1" {
		m["skip-cert-verify"] = true
	}
	if obfs := q.Get("obfs"); obfs != "" {
		m["obfs"] = obfs
		if op := q.Get("obfs-password"); op != "" {
			m["obfs-password"] = op
		}
	}
	return m, nil
}

func parseTuic(link string) (map[string]any, error) {
	u, err := url.Parse(link)
	if err != nil || u.Host == "" || u.User == nil {
		return nil, fmt.Errorf("tuic 链接无效")
	}
	q := u.Query()
	name := u.Fragment
	if name == "" {
		name = u.Hostname()
	}
	pwd, _ := u.User.Password()
	m := map[string]any{
		"name": name, "type": "tuic", "server": u.Hostname(), "port": toInt(u.Port()),
		"uuid": u.User.Username(), "password": pwd,
	}
	if sni := q.Get("sni"); sni != "" {
		m["sni"] = sni
	}
	if cc := q.Get("congestion_control"); cc != "" {
		m["congestion-controller"] = cc
	}
	if alpn := q.Get("alpn"); alpn != "" {
		m["alpn"] = strings.Split(alpn, ",")
	}
	if ur := q.Get("udp_relay_mode"); ur != "" {
		m["udp-relay-mode"] = ur
	}
	return m, nil
}

// applyNetworkOpts 填充 ws/grpc/h2 传输层选项（vmess/vless/trojan 通用）
func applyNetworkOpts(m map[string]any, network, host, path, headerType string) {
	switch network {
	case "ws":
		m["network"] = "ws"
		o := map[string]any{}
		if path != "" {
			o["path"] = path
		}
		if host != "" {
			o["headers"] = map[string]any{"Host": host}
		}
		if len(o) > 0 {
			m["ws-opts"] = o
		}
	case "grpc":
		m["network"] = "grpc"
		if path != "" {
			m["grpc-opts"] = map[string]any{"grpc-service-name": path}
		}
	case "h2", "http":
		m["network"] = "h2"
		o := map[string]any{}
		if path != "" {
			o["path"] = path
		}
		if host != "" {
			o["host"] = []string{host}
		}
		if len(o) > 0 {
			m["h2-opts"] = o
		}
	case "tcp", "":
		if headerType == "http" {
			m["network"] = "http"
			o := map[string]any{}
			if path != "" {
				o["path"] = []string{path}
			}
			if host != "" {
				o["headers"] = map[string]any{"Host": host}
			}
			if len(o) > 0 {
				m["http-opts"] = o
			}
		}
	}
}
