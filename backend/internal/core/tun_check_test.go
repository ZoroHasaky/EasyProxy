package core

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestEvaluateDeps(t *testing.T) {
	cases := []struct {
		name      string
		ipt       string
		probeErr  error
		nftModule bool
		wantSev   []string
	}{
		{"iptables available", "/sbin/iptables", nil, false, nil},
		{"iptables available with nftables", "/sbin/iptables", nil, true, nil},
		{"missing iptables with nftables", "", nil, true, []string{TunCheckSeverityWarning}},
		{"missing iptables without nftables", "", nil, false, []string{TunCheckSeverityError}},
		{"iptables probe failed", "/sbin/iptables", errors.New("exit status 1"), true, []string{TunCheckSeverityError}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := evaluateDeps(c.ipt, c.probeErr, c.nftModule)
			var sevs []string
			for _, w := range got {
				if w.Message == "" {
					t.Fatal("警告消息为空")
				}
				sevs = append(sevs, w.Severity)
			}
			if len(c.wantSev) == 0 && len(sevs) != 0 {
				t.Fatalf("期望无警告，got %v", sevs)
			}
			if !reflect.DeepEqual(sevs, c.wantSev) {
				t.Fatalf("severity = %v, want %v", sevs, c.wantSev)
			}
		})
	}
}

func TestTunCheckCanEnable(t *testing.T) {
	cases := []struct {
		name string
		res  TunCheckResult
		want bool
	}{
		{"device unavailable", TunCheckResult{OK: false, Detail: "缺少 NET_ADMIN"}, false},
		{"device and redirect ready", TunCheckResult{OK: true}, true},
		{"soft warning", TunCheckResult{OK: true, Warnings: []TunCheckWarning{{Severity: TunCheckSeverityWarning, Message: "fallback"}}}, true},
		{"redirect unavailable", TunCheckResult{OK: true, Warnings: []TunCheckWarning{{Severity: TunCheckSeverityError, Message: "iptables 执行异常"}}}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.res.canEnable(); got != c.want {
				t.Fatalf("canEnable()=%v, want %v", got, c.want)
			}
		})
	}
}

func TestCreateIPTablesLegacyShim(t *testing.T) {
	dir := t.TempDir()
	shimDir, err := createIPTablesLegacyShim(dir, "/sbin/iptables-legacy")
	if err != nil {
		t.Fatal(err)
	}
	if shimDir != filepath.Join(dir, "iptables") {
		t.Fatalf("shim dir=%q", shimDir)
	}
	data, err := os.ReadFile(filepath.Join(shimDir, "iptables"))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(data); !strings.Contains(got, "exec \"/sbin/iptables-legacy\" \"$@\"") {
		t.Fatalf("unexpected shim: %q", got)
	}
}
