//go:build !linux

package update

// ExecNewest 非 Linux 平台（开发环境）不支持自更新切换
func ExecNewest(dataDir, current string) {}
