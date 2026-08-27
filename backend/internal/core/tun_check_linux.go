//go:build linux

package core

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

// CheckTun 检测当前环境能否运行 TUN 透明代理：
// 硬性项（/dev/net/tun 存在且具备 CAP_NET_ADMIN，通过 TUNSETIFF 实际创建一次
// 临时设备验证）+ auto-redirect 依赖评估（nftables/iptables）。
func CheckTun() TunCheckResult {
	ok, detail := checkTunDevice()
	res := TunCheckResult{OK: ok, Detail: detail}
	if !ok {
		return res
	}
	iptPath, iptProbeErr := probeIPtables()
	res.Warnings = evaluateDeps(iptPath, iptProbeErr, hasNftablesModule())
	if len(res.Warnings) == 0 {
		res.Detail = "TUN 可用，auto-redirect 依赖正常"
	}
	res.CanEnable = res.canEnable()
	return res
}

// checkTunDevice 原 CheckTunAvailable 逻辑：验证 TUN 设备与权限
func checkTunDevice() (bool, string) {
	f, err := os.OpenFile("/dev/net/tun", os.O_RDWR, 0)
	if err != nil {
		if os.IsNotExist(err) {
			return false, "/dev/net/tun 不存在：compose 需映射 devices: /dev/net/tun"
		}
		return false, "无法打开 /dev/net/tun：" + err.Error() + "（需 host 网络与 NET_ADMIN 权限）"
	}
	defer f.Close()

	var ifr struct {
		name  [16]byte
		flags uint16
	}
	ifr.flags = unix.IFF_TUN | unix.IFF_NO_PI
	_, _, errno := unix.Syscall(unix.SYS_IOCTL, f.Fd(), unix.TUNSETIFF, uintptr(unsafe.Pointer(&ifr)))
	if errno != 0 {
		if errno == unix.EPERM {
			return false, "缺少 NET_ADMIN 权限：compose 需添加 cap_add: [NET_ADMIN]"
		}
		return false, fmt.Sprintf("TUN 设备初始化失败: %v", errno)
	}
	return true, "TUN 可用"
}

// probeIPtables 返回 mihomo 应使用的 iptables 路径；先实测默认 iptables，失败
// 后再尝试 iptables-legacy。部分 NAS 主机仅暴露 legacy netfilter 表，而容器内
// iptables 默认指向 nft 后端；此时 legacy 能成功读取 NAT 规则即可作为后备。
func probeIPtables() (path string, probeErr error) {
	path, probeErr = probeIPtablesCommand("iptables")
	if path != "" && probeErr == nil {
		return path, nil
	}
	legacyPath, legacyErr := probeIPtablesCommand("iptables-legacy")
	if legacyPath != "" && legacyErr == nil {
		return legacyPath, nil
	}
	return path, probeErr
}

// probeIPtablesCommand 返回指定前端是否可实际读取 NAT 规则。
func probeIPtablesCommand(name string) (path string, probeErr error) {
	p, err := exec.LookPath(name)
	if err != nil {
		return "", nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, p, "-t", "nat", "-S").Output()
	if err != nil {
		if len(out) == 0 && errors.Is(err, context.DeadlineExceeded) {
			return p, fmt.Errorf("iptables -t nat -S 超时")
		}
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
				msg = strings.TrimSpace(string(exitErr.Stderr))
			}
		}
		if msg == "" {
			msg = err.Error()
		}
		return p, fmt.Errorf("iptables -t nat -S 失败: %s", msg)
	}
	return p, nil
}

// processEnvWithIPTablesFallback 将 iptables-legacy 放到 Mihomo 子进程 PATH 的
// 最前面。仅在默认 iptables 探测失败、且 legacy 探测成功时启用；这样不影响
// 支持 nftables 的普通 Linux 主机，也能适配只提供 legacy 表的群晖等设备。
func processEnvWithIPTablesFallback(dataDir string) ([]string, error) {
	standardPath, standardErr := probeIPtablesCommand("iptables")
	if standardPath != "" && standardErr == nil {
		return os.Environ(), nil
	}
	legacyPath, legacyErr := probeIPtablesCommand("iptables-legacy")
	if legacyPath == "" || legacyErr != nil {
		return os.Environ(), nil
	}
	shimDir, err := createIPTablesLegacyShim(dataDir, legacyPath)
	if err != nil {
		return nil, err
	}
	return prependPath(os.Environ(), shimDir), nil
}

// hasNftablesModule 检查宿主内核是否加载 nf_tables 模块
func hasNftablesModule() bool {
	f, err := os.Open("/proc/modules")
	if err != nil {
		return false
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if strings.HasPrefix(sc.Text(), "nf_tables ") {
			return true
		}
	}
	return false
}
