package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// TUN 环境预检：除 /dev/net/tun 与 NET_ADMIN 权限外，mihomo 的 auto-redirect
// 还依赖内核 netfilter——优先走原生 nftables（netlink），内核不支持时退回
// iptables 命令。两者皆不可用时 TUN 将无法启动（内核仅记录一条 error 后继续运行，
// 面板状态灯不会变化），因此在预检阶段就按可用性分档提示。

const (
	TunCheckSeverityWarning = "warning" // 软警告：存在隐患但通常可正常工作
	TunCheckSeverityError   = "error"   // 高危：TUN 大概率无法启动
)

type TunCheckWarning struct {
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

type TunCheckResult struct {
	// OK 仅表示 /dev/net/tun 和 NET_ADMIN 已通过实测；CanEnable 还会纳入
	// auto-redirect 的 iptables/nftables 依赖，是界面和写接口是否允许开启的准则。
	OK                   bool              `json:"ok"`
	CanEnable            bool              `json:"can_enable"`
	Detail               string            `json:"detail"`
	Warnings             []TunCheckWarning `json:"warnings,omitempty"`
	LANForwardingWarning string            `json:"lan_forwarding_warning,omitempty"`
}

const lanForwardingWarningMessage = "检测到 Docker 的 FORWARD 默认拒绝，且 DOCKER-USER 未放行 Meta 与局域网网卡的双向转发；局域网设备经本机网关访问域名可能失败。请放行“LAN 网卡 ↔ Meta”双向转发流量。"

// BlockingReason 返回阻止开启 TUN 的具体原因。调用方不应只检查 OK：当 TUN
// 设备可创建、但 auto-redirect 后端不可用时，OK 为 true 而 CanEnable 为 false。
func (r TunCheckResult) BlockingReason() string {
	if !r.OK {
		return r.Detail
	}
	for _, warning := range r.Warnings {
		if warning.Severity == TunCheckSeverityError {
			return warning.Message
		}
	}
	return ""
}

func (r TunCheckResult) canEnable() bool {
	return r.BlockingReason() == ""
}

// evaluateLANForwardingWarning 根据 Docker 的 FORWARD/DOCKER-USER 规则判断
// 局域网与 Mihomo Meta TUN 之间的流量是否可能被默认 DROP 策略阻断。
// 这是运行后的风险提示，不阻止 TUN 启动：本机流量仍可能正常，受影响的是
// 将 EasyProxy 作为局域网网关时的转发流量。
func evaluateLANForwardingWarning(forwardChain, dockerUserChain string) string {
	forward := strings.ToLower(forwardChain)
	if !hasForwardDropPolicy(forward) || !strings.Contains(forward, "docker-user") {
		return ""
	}

	userChain := strings.ToLower(dockerUserChain)
	if hasMetaForwardAccept(userChain, true) && hasMetaForwardAccept(userChain, false) {
		return ""
	}
	return lanForwardingWarningMessage
}

func hasForwardDropPolicy(chain string) bool {
	return strings.Contains(chain, "policy drop") || strings.Contains(chain, "-p forward drop")
}

// lanToTun 为 true 时检查 LAN → Meta；false 时检查 Meta → LAN。
// 同时兼容 nft 与 iptables-save 风格的规则输出。
func hasMetaForwardAccept(chain string, lanToTun bool) bool {
	for _, line := range strings.Split(chain, "\n") {
		if !strings.Contains(line, "accept") {
			continue
		}
		if lanToTun && (strings.Contains(line, `oifname "meta"`) || strings.Contains(line, "-o meta")) {
			return true
		}
		if !lanToTun && (strings.Contains(line, `iifname "meta"`) || strings.Contains(line, "-i meta")) {
			return true
		}
	}
	return false
}

func createIPTablesLegacyShim(dataDir, legacyPath string) (string, error) {
	shimDir := filepath.Join(dataDir, "iptables")
	if err := os.MkdirAll(shimDir, 0o755); err != nil {
		return "", err
	}
	shimPath := filepath.Join(shimDir, "iptables")
	script := fmt.Sprintf("#!/bin/sh\nexec %q \"$@\"\n", legacyPath)
	if err := os.WriteFile(shimPath, []byte(script), 0o755); err != nil {
		return "", err
	}
	return shimDir, nil
}

func prependPath(env []string, dir string) []string {
	prefix := dir + string(os.PathListSeparator)
	for i, value := range env {
		if strings.HasPrefix(value, "PATH=") {
			out := append([]string(nil), env...)
			out[i] = "PATH=" + prefix + strings.TrimPrefix(value, "PATH=")
			return out
		}
	}
	return append(append([]string(nil), env...), "PATH="+prefix)
}

// evaluateDeps 评估 auto-redirect 依赖。与探测 IO 分离以便跨平台表测：
// iptablesPath 为空表示容器内没有 iptables 命令；probeErr 非空表示命令存在但
// 实际执行失败（权限/内核 netfilter 不可用）；hasNftModule 表示宿主内核已加载
// nf_tables 模块（模块表无 namespace，容器内可见宿主状态；内置编译的内核会漏报，
// 因此仅用于"确认可用"，漏报时降级为高危提示）。
func evaluateDeps(iptablesPath string, probeErr error, hasNftModule bool) []TunCheckWarning {
	var ws []TunCheckWarning
	if iptablesPath == "" {
		if hasNftModule {
			ws = append(ws, TunCheckWarning{
				Severity: TunCheckSeverityWarning,
				Message:  "容器内无 iptables 命令；当前内核已加载 nftables 模块，mihomo 将走原生 nftables 路径，通常无碍",
			})
		} else {
			ws = append(ws, TunCheckWarning{
				Severity: TunCheckSeverityError,
				Message:  "容器内无 iptables 命令且未检测到内核 nftables 模块：auto-redirect 无可用后端，TUN 大概率无法启动（常见于裁剪内核的 NAS 系统，如群晖 DSM）。请使用 v0.2.7 及以上镜像，或在容器内补充 iptables",
			})
		}
		return ws
	}
	if probeErr != nil {
		ws = append(ws, TunCheckWarning{
			Severity: TunCheckSeverityError,
			Message:  "iptables 存在但执行异常（" + probeErr.Error() + "），auto-redirect 可能失败",
		})
	}
	return ws
}
