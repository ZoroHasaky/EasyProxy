//go:build linux

package core

import (
	"os"
	"strconv"
	"strings"
)

// processMemoryBytes returns the process resident set size reported by Linux.
func processMemoryBytes(pid int) uint64 {
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[0] != "VmRSS:" {
			continue
		}
		kilobytes, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return 0
		}
		return kilobytes * 1024
	}
	return 0
}
