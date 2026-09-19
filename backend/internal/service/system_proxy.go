package service

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

var ErrSystemProxyUnsupported = errors.New("当前系统不支持桌面系统代理")

type SystemProxyStatus struct {
	Supported bool   `json:"supported"`
	Enabled   bool   `json:"enabled"`
	Host      string `json:"host,omitempty"`
	Port      int    `json:"port,omitempty"`
	Warning   string `json:"warning,omitempty"`
}

type SystemProxyManager interface {
	Status() SystemProxyStatus
	Enable(port int) error
	Disable() error
}

type systemProxyState struct {
	Enabled bool                  `json:"enabled"`
	Host    string                `json:"host"`
	Port    int                   `json:"port"`
	Windows *windowsProxySnapshot `json:"windows,omitempty"`
	Mac     []macProxySnapshot    `json:"mac,omitempty"`
}

type windowsProxySnapshot struct {
	ProxyEnable          uint32 `json:"proxy_enable"`
	ProxyEnablePresent   bool   `json:"proxy_enable_present"`
	ProxyServer          string `json:"proxy_server"`
	ProxyServerPresent   bool   `json:"proxy_server_present"`
	ProxyOverride        string `json:"proxy_override"`
	ProxyOverridePresent bool   `json:"proxy_override_present"`
	AutoConfigURL        string `json:"auto_config_url"`
	AutoConfigURLPresent bool   `json:"auto_config_url_present"`
	AutoDetect           uint32 `json:"auto_detect"`
	AutoDetectPresent    bool   `json:"auto_detect_present"`
}

type macProxySnapshot struct {
	Service string          `json:"service"`
	Web     macProxySetting `json:"web"`
	Secure  macProxySetting `json:"secure"`
}

type macProxySetting struct {
	Enabled bool   `json:"enabled"`
	Server  string `json:"server"`
	Port    int    `json:"port"`
}

func systemProxyStatePath(dataDir string) string {
	return filepath.Join(dataDir, "system-proxy.json")
}

func loadSystemProxyState(dataDir string) (*systemProxyState, error) {
	data, err := os.ReadFile(systemProxyStatePath(dataDir))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var state systemProxyState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func saveSystemProxyState(dataDir string, state *systemProxyState) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	tmp := systemProxyStatePath(dataDir) + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, systemProxyStatePath(dataDir))
}

func clearSystemProxyState(dataDir string) error {
	err := os.Remove(systemProxyStatePath(dataDir))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
