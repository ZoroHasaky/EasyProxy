package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

type ReadyInfo struct {
	Addr         string `json:"addr"`
	URL          string `json:"url"`
	PID          int    `json:"pid"`
	ControlToken string `json:"control_token"`
}

type BackendProcess struct {
	path    string
	dataDir string
	version string
	mu      sync.Mutex
	cmd     *exec.Cmd
	info    ReadyInfo
	ready   string
}

func NewBackendProcess(path, dataDir, version string) *BackendProcess {
	return &BackendProcess{path: path, dataDir: dataDir, version: version, ready: filepath.Join(dataDir, "desktop-ready.json")}
}

func (p *BackendProcess) Start() error {
	p.mu.Lock()
	if p.cmd != nil && p.cmd.Process != nil {
		p.mu.Unlock()
		return nil
	}
	_ = os.Remove(p.ready)
	cmd := exec.Command(p.path, "--desktop-mode", "--addr", "127.0.0.1:0", "--data", p.dataDir, "--ready-file", p.ready)
	cmd.Dir = p.dataDir
	cmd.Env = append(os.Environ(), "EASYPROXY_DESKTOP_VERSION="+p.version)
	logPath, err := os.OpenFile(filepath.Join(p.dataDir, "desktop-server.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		p.mu.Unlock()
		return err
	}
	cmd.Stdout = logPath
	cmd.Stderr = logPath
	if err := cmd.Start(); err != nil {
		_ = logPath.Close()
		p.mu.Unlock()
		return err
	}
	p.cmd = cmd
	go func() {
		err := cmd.Wait()
		_ = logPath.Close()
		if err != nil {
			log.Printf("[desktop] backend 已退出: %v", err)
		}
		p.mu.Lock()
		p.cmd = nil
		p.mu.Unlock()
	}()
	p.mu.Unlock()
	return p.waitReady()
}

func (p *BackendProcess) waitReady() error {
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(p.ready)
		if err == nil {
			var info ReadyInfo
			if err := json.Unmarshal(data, &info); err == nil && info.URL != "" {
				p.mu.Lock()
				p.info = info
				p.mu.Unlock()
				return waitHTTP(info.URL)
			}
		}
		p.mu.Lock()
		cmd := p.cmd
		p.mu.Unlock()
		if cmd == nil {
			return fmt.Errorf("backend 启动后立即退出")
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("等待 backend 就绪超时")
}

func waitHTTP(url string) error {
	client := &http.Client{Timeout: 500 * time.Millisecond}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.Get(url + "/api/meta")
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode < http.StatusInternalServerError {
				return nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("backend 已监听但 HTTP 服务未就绪")
}

func (p *BackendProcess) URL() string { p.mu.Lock(); defer p.mu.Unlock(); return p.info.URL }

func (p *BackendProcess) systemProxyStatus() (map[string]any, error) {
	p.mu.Lock()
	base, token := p.info.URL, p.info.ControlToken
	p.mu.Unlock()
	req, err := http.NewRequest(http.MethodGet, base+"/api/desktop/system-proxy", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-EasyProxy-Desktop-Token", token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("系统代理状态请求失败: HTTP %d", resp.StatusCode)
	}
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result, nil
}

func (p *BackendProcess) setSystemProxy(enabled bool) error {
	p.mu.Lock()
	base, token := p.info.URL, p.info.ControlToken
	p.mu.Unlock()
	body, _ := json.Marshal(map[string]bool{"enabled": enabled})
	req, err := http.NewRequest(http.MethodPut, base+"/api/desktop/system-proxy", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-EasyProxy-Desktop-Token", token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<10))
		return fmt.Errorf("系统代理请求失败: %s", string(message))
	}
	return nil
}

func (p *BackendProcess) toggleSystemProxy() error {
	status, err := p.systemProxyStatus()
	if err != nil {
		return err
	}
	enabled, _ := status["enabled"].(bool)
	p.mu.Lock()
	base, token := p.info.URL, p.info.ControlToken
	p.mu.Unlock()
	body, _ := json.Marshal(map[string]bool{"enabled": !enabled})
	req, err := http.NewRequest(http.MethodPut, base+"/api/desktop/system-proxy", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-EasyProxy-Desktop-Token", token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<10))
		return fmt.Errorf("系统代理更新失败: %s", string(message))
	}
	return nil
}

func (p *BackendProcess) Restart() error {
	if err := p.Stop(); err != nil {
		return err
	}
	return p.Start()
}

func (p *BackendProcess) Stop() error {
	p.mu.Lock()
	cmd := p.cmd
	p.cmd = nil
	base, token := p.info.URL, p.info.ControlToken
	p.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	if base != "" && token != "" {
		if err := p.setSystemProxy(false); err != nil {
			log.Printf("[desktop] 退出前恢复系统代理失败: %v", err)
		}
		if req, err := http.NewRequest(http.MethodPost, base+"/api/desktop/shutdown", nil); err == nil {
			req.Header.Set("X-EasyProxy-Desktop-Token", token)
			if resp, err := http.DefaultClient.Do(req); err == nil {
				_ = resp.Body.Close()
				deadline := time.Now().Add(3 * time.Second)
				for time.Now().Before(deadline) {
					if !processAlive(cmd) {
						return nil
					}
					time.Sleep(50 * time.Millisecond)
				}
			}
		}
	}
	if err := cmd.Process.Kill(); err != nil {
		return err
	}
	return nil
}

func processAlive(cmd *exec.Cmd) bool {
	if cmd == nil || cmd.Process == nil {
		return false
	}
	return cmd.ProcessState == nil
}
