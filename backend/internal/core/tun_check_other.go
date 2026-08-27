//go:build !linux

package core

import "os"

// CheckTun 非 Linux 开发环境无法检测，视为可用
func CheckTun() TunCheckResult {
	return TunCheckResult{OK: true, CanEnable: true, Detail: "非 Linux 环境，跳过检测"}
}

func processEnvWithIPTablesFallback(string) ([]string, error) {
	return os.Environ(), nil
}
