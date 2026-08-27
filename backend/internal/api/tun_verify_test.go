package api

import (
	"strings"
	"testing"
)

func TestTunFailureReason(t *testing.T) {
	tunErr := `time="2026-08-26T15:01:29Z" level=error msg="Start TUN listening error: initialize auto redirect: iptables is required"`
	cases := []struct {
		name string
		logs []string
		want string
	}{
		{"empty logs", nil, ""},
		{"no error lines", []string{`level=info msg="start initial config in progress"`}, ""},
		{"tun error first", []string{tunErr, `level=error msg="something else failed"`}, tunErr},
		{"tun error after other errors", []string{
			`level=error msg="dns server 8.8.8.8:53 resolve failed"`, tunErr,
		}, tunErr},
		{"only unrelated errors", []string{`level=error msg="geoip download failed"`, `level=warning msg="x"`},
			`level=error msg="geoip download failed"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := tunFailureReason(c.logs)
			want := c.want
			if len(want) > 40 {
				want = want[:40]
			}
			if want != "" && !strings.Contains(got, want) {
				t.Fatalf("tunFailureReason() = %q, want contains %q", got, want)
			}
			if c.want == "" && got != "" {
				t.Fatalf("期望空结果，got %q", got)
			}
		})
	}
}
