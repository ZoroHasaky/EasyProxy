//go:build darwin

package service

import (
	"bufio"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

type darwinSystemProxy struct {
	dataDir string
}

func NewSystemProxy(dataDir string) SystemProxyManager {
	return &darwinSystemProxy{dataDir: dataDir}
}

func (p *darwinSystemProxy) Status() SystemProxyStatus {
	state, err := loadSystemProxyState(p.dataDir)
	if err != nil || state == nil || !state.Enabled {
		return SystemProxyStatus{Supported: true}
	}
	expected := fmt.Sprintf("127.0.0.1:%d", state.Port)
	for _, service := range state.Mac {
		web, webErr := macProxySettingFor(service.Service, false)
		secure, secureErr := macProxySettingFor(service.Service, true)
		if webErr == nil && secureErr == nil && web.Enabled && secure.Enabled && web.Server+":"+strconv.Itoa(web.Port) == expected && secure.Server+":"+strconv.Itoa(secure.Port) == expected {
			return SystemProxyStatus{Supported: true, Enabled: true, Host: "127.0.0.1", Port: state.Port}
		}
	}
	return SystemProxyStatus{Supported: true, Port: state.Port, Warning: "系统代理已被其他程序修改，EasyProxy 未覆盖当前设置"}
}

func (p *darwinSystemProxy) Enable(port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("代理端口无效: %d", port)
	}
	services, err := macNetworkServices()
	if err != nil {
		return err
	}
	snapshots := make([]macProxySnapshot, 0, len(services))
	for _, service := range services {
		web, err := macProxySettingFor(service, false)
		if err != nil {
			return err
		}
		secure, err := macProxySettingFor(service, true)
		if err != nil {
			return err
		}
		snapshots = append(snapshots, macProxySnapshot{Service: service, Web: web, Secure: secure})
		if err := setMacProxy(service, false, true, "127.0.0.1", port); err != nil {
			return err
		}
		if err := setMacProxy(service, true, true, "127.0.0.1", port); err != nil {
			return err
		}
	}
	return saveSystemProxyState(p.dataDir, &systemProxyState{Enabled: true, Host: "127.0.0.1", Port: port, Mac: snapshots})
}

func (p *darwinSystemProxy) Disable() error {
	state, err := loadSystemProxyState(p.dataDir)
	if err != nil {
		return err
	}
	if state == nil || len(state.Mac) == 0 {
		return nil
	}
	if status := p.Status(); status.Warning != "" {
		return fmt.Errorf("%s", status.Warning)
	}
	for _, service := range state.Mac {
		if err := setMacProxy(service.Service, false, service.Web.Enabled, service.Web.Server, service.Web.Port); err != nil {
			return err
		}
		if err := setMacProxy(service.Service, true, service.Secure.Enabled, service.Secure.Server, service.Secure.Port); err != nil {
			return err
		}
	}
	return clearSystemProxyState(p.dataDir)
}

func macNetworkServices() ([]string, error) {
	out, err := exec.Command("networksetup", "-listallnetworkservices").Output()
	if err != nil {
		return nil, err
	}
	services := []string{}
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		value := strings.TrimSpace(scanner.Text())
		if value == "" || strings.HasPrefix(value, "An asterisk") {
			continue
		}
		value = strings.TrimPrefix(value, "*")
		value = strings.TrimSpace(value)
		if value != "" {
			services = append(services, value)
		}
	}
	return services, scanner.Err()
}

func macProxySettingFor(service string, secure bool) (macProxySetting, error) {
	kind := "-getwebproxy"
	if secure {
		kind = "-getsecurewebproxy"
	}
	out, err := exec.Command("networksetup", kind, service).Output()
	if err != nil {
		return macProxySetting{}, err
	}
	result := macProxySetting{}
	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		parts := strings.SplitN(scanner.Text(), ":", 2)
		if len(parts) != 2 {
			continue
		}
		key, value := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		switch key {
		case "Enabled":
			result.Enabled = strings.EqualFold(value, "Yes")
		case "Server":
			result.Server = value
		case "Port":
			result.Port, _ = strconv.Atoi(value)
		}
	}
	return result, scanner.Err()
}

func setMacProxy(service string, secure, enabled bool, server string, port int) error {
	kind := "-setwebproxy"
	state := "-setwebproxystate"
	if secure {
		kind, state = "-setsecurewebproxy", "-setsecurewebproxystate"
	}
	if enabled {
		if err := exec.Command("networksetup", kind, service, server, strconv.Itoa(port)).Run(); err != nil {
			return err
		}
		return exec.Command("networksetup", state, service, "on").Run()
	}
	return exec.Command("networksetup", state, service, "off").Run()
}
