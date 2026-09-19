//go:build windows

package service

import (
	"fmt"
	"strings"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const internetSettingsPath = `Software\Microsoft\Windows\CurrentVersion\Internet Settings`

type windowsSystemProxy struct {
	dataDir string
}

func NewSystemProxy(dataDir string) SystemProxyManager {
	return &windowsSystemProxy{dataDir: dataDir}
}

func (p *windowsSystemProxy) Status() SystemProxyStatus {
	key, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsPath, registry.QUERY_VALUE)
	if err != nil {
		return SystemProxyStatus{Warning: err.Error()}
	}
	defer key.Close()
	enabled, _, _ := key.GetIntegerValue("ProxyEnable")
	server, _, _ := key.GetStringValue("ProxyServer")
	state, _ := loadSystemProxyState(p.dataDir)
	result := SystemProxyStatus{Supported: true, Enabled: enabled != 0, Host: server}
	if state != nil && state.Enabled {
		expected := fmt.Sprintf("127.0.0.1:%d", state.Port)
		result.Port = state.Port
		if enabled == 0 || !strings.Contains(server, expected) {
			result.Enabled = false
			result.Warning = "系统代理已被其他程序修改，EasyProxy 未覆盖当前设置"
		}
	}
	return result
}

func (p *windowsSystemProxy) Enable(port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("代理端口无效: %d", port)
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsPath, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	snapshot, err := readWindowsSnapshot(key)
	if err != nil {
		return err
	}
	state := &systemProxyState{Enabled: true, Host: "127.0.0.1", Port: port, Windows: snapshot}
	if err := key.SetDWordValue("ProxyEnable", 1); err != nil {
		return err
	}
	if err := key.SetStringValue("ProxyServer", fmt.Sprintf("127.0.0.1:%d", port)); err != nil {
		return err
	}
	_ = key.DeleteValue("AutoConfigURL")
	_ = key.SetDWordValue("AutoDetect", 0)
	if err := saveSystemProxyState(p.dataDir, state); err != nil {
		return err
	}
	refreshWindowsProxy()
	return nil
}

func (p *windowsSystemProxy) Disable() error {
	key, err := registry.OpenKey(registry.CURRENT_USER, internetSettingsPath, registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	state, err := loadSystemProxyState(p.dataDir)
	if err != nil {
		return err
	}
	if state == nil || state.Windows == nil {
		return nil
	}
	current := p.Status()
	if !current.Enabled && current.Warning != "" {
		return fmt.Errorf("%s", current.Warning)
	}
	if err := restoreWindowsSnapshot(key, state.Windows); err != nil {
		return err
	}
	refreshWindowsProxy()
	return clearSystemProxyState(p.dataDir)
}

func readWindowsSnapshot(key registry.Key) (*windowsProxySnapshot, error) {
	result := &windowsProxySnapshot{}
	if value, _, err := key.GetIntegerValue("ProxyEnable"); err == nil {
		result.ProxyEnable, result.ProxyEnablePresent = uint32(value), true
	}
	if value, _, err := key.GetStringValue("ProxyServer"); err == nil {
		result.ProxyServer, result.ProxyServerPresent = value, true
	}
	if value, _, err := key.GetStringValue("ProxyOverride"); err == nil {
		result.ProxyOverride, result.ProxyOverridePresent = value, true
	}
	if value, _, err := key.GetStringValue("AutoConfigURL"); err == nil {
		result.AutoConfigURL, result.AutoConfigURLPresent = value, true
	}
	if value, _, err := key.GetIntegerValue("AutoDetect"); err == nil {
		result.AutoDetect, result.AutoDetectPresent = uint32(value), true
	}
	return result, nil
}

func restoreWindowsSnapshot(key registry.Key, snapshot *windowsProxySnapshot) error {
	if snapshot.ProxyEnablePresent {
		if err := key.SetDWordValue("ProxyEnable", snapshot.ProxyEnable); err != nil {
			return err
		}
	} else {
		_ = key.DeleteValue("ProxyEnable")
	}
	if snapshot.ProxyServerPresent {
		if err := key.SetStringValue("ProxyServer", snapshot.ProxyServer); err != nil {
			return err
		}
	} else {
		_ = key.DeleteValue("ProxyServer")
	}
	if snapshot.ProxyOverridePresent {
		if err := key.SetStringValue("ProxyOverride", snapshot.ProxyOverride); err != nil {
			return err
		}
	} else {
		_ = key.DeleteValue("ProxyOverride")
	}
	if snapshot.AutoConfigURLPresent {
		if err := key.SetStringValue("AutoConfigURL", snapshot.AutoConfigURL); err != nil {
			return err
		}
	} else {
		_ = key.DeleteValue("AutoConfigURL")
	}
	if snapshot.AutoDetectPresent {
		if err := key.SetDWordValue("AutoDetect", snapshot.AutoDetect); err != nil {
			return err
		}
	} else {
		_ = key.DeleteValue("AutoDetect")
	}
	return nil
}

func refreshWindowsProxy() {
	dll := windows.NewLazySystemDLL("wininet.dll")
	proc := dll.NewProc("InternetSetOptionW")
	_, _, _ = proc.Call(0, 39, 0, 0)
	_, _, _ = proc.Call(0, 37, 0, 0)
}
