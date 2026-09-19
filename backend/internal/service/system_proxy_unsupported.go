//go:build !windows && !darwin

package service

type unsupportedSystemProxy struct{}

func NewSystemProxy(_ string) SystemProxyManager {
	return unsupportedSystemProxy{}
}

func (unsupportedSystemProxy) Status() SystemProxyStatus {
	return SystemProxyStatus{}
}

func (unsupportedSystemProxy) Enable(_ int) error {
	return ErrSystemProxyUnsupported
}

func (unsupportedSystemProxy) Disable() error {
	return ErrSystemProxyUnsupported
}
