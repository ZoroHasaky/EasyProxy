package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Client mihomo external-controller REST 客户端
type Client struct {
	base   string
	secret string
	hc     *http.Client
}

type RuleProviderRuntime struct {
	Name        string `json:"name"`
	Behavior    string `json:"behavior"`
	Format      string `json:"format"`
	RuleCount   int    `json:"ruleCount"`
	UpdatedAt   string `json:"updatedAt"`
	VehicleType string `json:"vehicleType"`
}

// ProxyRuntime 是 Mihomo 当前代理或策略组的运行时选择状态。
type ProxyRuntime struct {
	Now string `json:"now"`
}

func NewClient(port int, secret string) *Client {
	return &Client{
		base:   fmt.Sprintf("http://127.0.0.1:%d", port),
		secret: secret,
		hc:     &http.Client{Timeout: 120 * time.Second},
	}
}

func (c *Client) BaseURL() string { return c.base }

func (c *Client) do(method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.secret)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("mihomo API %s %s: %d %s", method, path, resp.StatusCode, truncate(string(data), 300))
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func (c *Client) Version() (string, error) {
	var out struct {
		Version string `json:"version"`
	}
	if err := c.do(http.MethodGet, "/version", nil, &out); err != nil {
		return "", err
	}
	return out.Version, nil
}

func (c *Client) GetConfigs(out *map[string]any) error {
	return c.do(http.MethodGet, "/configs", nil, out)
}

func (c *Client) GetRuleProviders() (map[string]RuleProviderRuntime, error) {
	var out struct {
		Providers map[string]RuleProviderRuntime `json:"providers"`
	}
	if err := c.do(http.MethodGet, "/providers/rules", nil, &out); err != nil {
		return nil, err
	}
	if out.Providers == nil {
		out.Providers = map[string]RuleProviderRuntime{}
	}
	return out.Providers, nil
}

// GetProxies 读取策略组当前选中的下一级目标；只查询本机 external-controller。
func (c *Client) GetProxies() (map[string]ProxyRuntime, error) {
	var out struct {
		Proxies map[string]ProxyRuntime `json:"proxies"`
	}
	if err := c.do(http.MethodGet, "/proxies", nil, &out); err != nil {
		return nil, err
	}
	if out.Proxies == nil {
		out.Proxies = map[string]ProxyRuntime{}
	}
	return out.Proxies, nil
}

// UpdateRuleProvider 请求 Mihomo 立即下载并加载指定的远程规则源。
func (c *Client) UpdateRuleProvider(name string) error {
	return c.do(http.MethodPut, "/providers/rules/"+url.PathEscape(name), nil, nil)
}

// ReloadConfig 热重载指定路径的配置
func (c *Client) ReloadConfig(path string) error {
	return c.do(http.MethodPut, "/configs?force=true", map[string]any{"path": path}, nil)
}

func (c *Client) Restart() error {
	return c.do(http.MethodPost, "/restart", nil, nil)
}

func (c *Client) PatchConfigs(patch map[string]any) error {
	return c.do(http.MethodPatch, "/configs", patch, nil)
}

// UpdateGeoDatabases 请求 mihomo 立即按当前生效配置刷新 GeoIP 与 GeoSite 数据库。
func (c *Client) UpdateGeoDatabases() error {
	return c.do(http.MethodPost, "/configs/geo", nil, nil)
}

// DelayGroup 整组并发测速，返回 节点名->延迟ms（超时/失败的节点不出现在结果里）
func (c *Client) DelayGroup(group, testURL string, timeout int) (map[string]uint16, error) {
	var out map[string]uint16
	path := fmt.Sprintf("/group/%s/delay?url=%s&timeout=%d", group, testURL, timeout)
	if err := c.do(http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Delay 单节点测速，返回延迟 ms
func (c *Client) Delay(name, testURL string, timeout int) (uint16, error) {
	var out map[string]uint16
	path := fmt.Sprintf("/proxies/%s/delay?url=%s&timeout=%d", url.PathEscape(name), testURL, timeout)
	if err := c.do(http.MethodGet, path, nil, &out); err != nil {
		return 0, err
	}
	if d, ok := out["delay"]; ok {
		return d, nil
	}
	return 0, fmt.Errorf("内核未返回延迟结果")
}

func (c *Client) CloseConnection(id string) error {
	return c.do(http.MethodDelete, "/connections/"+id, nil, nil)
}

func (c *Client) CloseAllConnections() error {
	return c.do(http.MethodDelete, "/connections", nil, nil)
}
