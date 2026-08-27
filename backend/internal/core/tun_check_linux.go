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

// probeIPtables 返回 iptables 路径；命令存在时顺带实测一次 NAT 规则读取
// （同时验证权限与内核 netfilter 链路），失败以 probeErr 返回。
func probeIPtables() (path string, probeErr error) {
	p, err := exec.LookPath("iptables")
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
