package update

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestNewHTTPClientUsesProxy(t *testing.T) {
	hc, err := newHTTPClient("127.0.0.1:7890")
	if err != nil {
		t.Fatal(err)
	}
	transport, ok := hc.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T", hc.Transport)
	}
	req, _ := http.NewRequest(http.MethodGet, "https://github.com", nil)
	proxyURL, err := transport.Proxy(req)
	if err != nil {
		t.Fatal(err)
	}
	if proxyURL == nil || proxyURL.String() != "http://127.0.0.1:7890" {
		t.Fatalf("proxy = %v", proxyURL)
	}
}

func TestGetLatestUsesGitHubReleaseRedirect(t *testing.T) {
	requested := []string{}
	hc := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requested = append(requested, req.URL.String())
		resp := &http.Response{
			Header:  make(http.Header),
			Body:    io.NopCloser(strings.NewReader("")),
			Request: req,
		}
		switch req.URL.Path {
		case "/owner/repo/releases/latest":
			resp.StatusCode = http.StatusFound
			resp.Header.Set("Location", "https://github.com/owner/repo/releases/tag/v1.2.3")
		case "/owner/repo/releases/tag/v1.2.3":
			resp.StatusCode = http.StatusOK
		default:
			t.Fatalf("unexpected request: %s", req.URL)
		}
		return resp, nil
	})}

	rel, err := getLatest(context.Background(), "owner/repo", hc)
	if err != nil {
		t.Fatal(err)
	}
	if rel.TagName != "v1.2.3" || rel.Repo != "owner/repo" {
		t.Fatalf("release = %#v", rel)
	}
	if len(requested) != 2 {
		t.Fatalf("requests = %#v", requested)
	}
	for _, requestURL := range requested {
		if strings.Contains(requestURL, "api.github.com") {
			t.Fatalf("unexpected GitHub API request: %s", requestURL)
		}
	}
}

func TestReleaseAssetURL(t *testing.T) {
	got := releaseAssetURL("owner/repo", "v1.2.3", "easyproxy-linux-amd64.tar.gz")
	want := "https://github.com/owner/repo/releases/download/v1.2.3/easyproxy-linux-amd64.tar.gz"
	if got != want {
		t.Fatalf("asset URL = %q, want %q", got, want)
	}
}

func TestNormalizeRepoRejectsInvalidValue(t *testing.T) {
	if _, err := normalizeRepo("https://github.com/owner/repo"); err == nil {
		t.Fatal("expected invalid repository error")
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
