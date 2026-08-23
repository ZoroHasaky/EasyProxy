//go:build linux

package core

import (
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/unix"
)

// CheckTunAvailable 检测当前环境能否创建 TUN 设备：
// /dev/net/tun 存在且具备 CAP_NET_ADMIN（通过 TUNSETIFF 实际创建一次临时设备验证）
func CheckTunAvailable() (bool, string) {
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
