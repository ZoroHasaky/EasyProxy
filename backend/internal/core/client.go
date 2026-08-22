package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client mihomo external-controller REST 客户端
type Client struct {
	base   string
	secret string
	hc     *http.Client
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

// DelayGroup 整组并发测速，返回 节点名->延迟ms（超时/失败的节点不出现在结果里）
func (c *Client) DelayGroup(group, testURL string, timeout int) (map[string]uint16, error) {
	var out map[string]uint16
	path := fmt.Sprintf("/group/%s/delay?url=%s&timeout=%d", group, testURL, timeout)
	if err := c.do(http.MethodGet, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) CloseConnection(id string) error {
	return c.do(http.MethodDelete, "/connections/"+id, nil, nil)
}

func (c *Client) CloseAllConnections() error {
	return c.do(http.MethodDelete, "/connections", nil, nil)
}
