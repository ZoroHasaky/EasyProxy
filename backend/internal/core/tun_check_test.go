package core

import (
	"errors"
	"reflect"
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
