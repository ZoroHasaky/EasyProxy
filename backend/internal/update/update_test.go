package update

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestNewHTTPClientUsesProxy(t *testing.T) {
	hc, err := newHTTPClient("127.0.0.1:7890")
	if err != nil {
		t.Fatal(err)
	}
	transport, ok := hc.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T", hc.Transport)
	}
	req, _ := http.NewRequest(http.MethodGet, "https://api.github.com", nil)
	proxyURL, err := transport.Proxy(req)
	if err != nil {
		t.Fatal(err)
	}
	if proxyURL == nil || proxyURL.String() != "http://127.0.0.1:7890" {
		t.Fatalf("proxy = %v", proxyURL)
	}
}

func TestProgressReaderReportsBytes(t *testing.T) {
	var completed, total int64
	reader := &progressReader{
		r:     strings.NewReader("easyproxy"),
		total: 9,
		stage: "downloading",
		progress: func(stage string, done, size int64) {
			if stage != "downloading" {
				t.Fatalf("stage = %q", stage)
			}
			completed, total = done, size
		},
	}
	if _, err := io.ReadAll(reader); err != nil {
		t.Fatal(err)
	}
	if completed != 9 || total != 9 {
		t.Fatalf("progress = %d/%d", completed, total)
	}
}
