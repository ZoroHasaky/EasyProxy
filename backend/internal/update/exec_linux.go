//go:build linux

package update

import (
	"os"
	"path/filepath"
	"syscall"

	"ezproxy/internal/core"
)

// ExecNewest 若 /data/bin 中存在比当前版本新的面板二进制则 exec 切换（进程不退出，PID 不变）
func ExecNewest(dataDir, current string) {
	entries, err := os.ReadDir(filepath.Join(dataDir, "bin"))
	if err != nil {
		return
	}
	best := ""
	bestVer := current
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		m := binVerRe.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		if core.CompareSemver(m[1], bestVer) > 0 {
			bestVer = m[1]
			best = filepath.Join(dataDir, "bin", e.Name())
		}
	}
	if best == "" {
		return
	}
	_ = syscall.Exec(best, os.Args, os.Environ())
}
