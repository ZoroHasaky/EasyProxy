//go:build !linux

package core

// processMemoryBytes is unavailable on non-Linux development platforms.
func processMemoryBytes(pid int) uint64 {
	return 0
}
