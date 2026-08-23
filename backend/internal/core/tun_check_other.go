//go:build !linux

package core

// CheckTunAvailable 非 Linux 开发环境无法检测，视为可用
func CheckTunAvailable() (bool, string) {
	return true, "非 Linux 环境，跳过检测"
}
