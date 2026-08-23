// Package update 面板自更新：检测 GitHub Release → 下载校验 → 落盘 /data/bin → exec 替换
package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"easyproxy/internal/core"
)

const githubAPI = "https://api.github.com"

type Asset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}

type Release struct {
	TagName string  `json:"tag_name"`
	Notes   string  `json:"body"`
	Assets  []Asset `json:"assets"`
}

type CheckResult struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	HasUpdate bool   `json:"has_update"`
	Notes     string `json:"notes"`
	URL       string `json:"url"`
	Error     string `json:"error,omitempty"`
}

type ProgressFunc func(stage string, completed, total int64)

func newHTTPClient(proxyAddr string) (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxyAddr != "" {
		proxyURL, err := url.Parse("http://" + proxyAddr)
		if err != nil {
			return nil, fmt.Errorf("代理地址无效: %w", err)
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	return &http.Client{Transport: transport}, nil
}

func getLatest(ctx context.Context, repo string, hc *http.Client) (*Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubAPI+"/repos/"+repo+"/releases/latest", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "EasyProxy")
	resp, err := hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		var apiErr struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(body, &apiErr)
		if apiErr.Message != "" {
			return nil, fmt.Errorf("GitHub API HTTP %d: %s", resp.StatusCode, apiErr.Message)
		}
		return nil, fmt.Errorf("GitHub API HTTP %d", resp.StatusCode)
	}
	var rel Release
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, err
	}
	return &rel, nil
}

// Check 检查面板新版本
func Check(repo, current, proxyAddr string) *CheckResult {
	hc, err := newHTTPClient(proxyAddr)
	if err != nil {
		return &CheckResult{Current: current, Error: err.Error()}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	rel, err := getLatest(ctx, repo, hc)
	if err != nil {
		return &CheckResult{Current: current, Error: err.Error()}
	}
	latest := strings.TrimPrefix(rel.TagName, "v")
	res := &CheckResult{
		Current: current,
		Latest:  latest,
		Notes:   rel.Notes,
		URL:     "https://github.com/" + repo + "/releases/latest",
	}
	if core.CompareSemver(current, latest) < 0 {
		res.HasUpdate = true
	}
	return res
}

func assetURL(rel *Release, name string) string {
	for _, a := range rel.Assets {
		if a.Name == name {
			return a.URL
		}
	}
	return ""
}

type progressReader struct {
	r         io.Reader
	completed int64
	total     int64
	stage     string
	progress  ProgressFunc
}

func (r *progressReader) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	r.completed += int64(n)
	r.progress(r.stage, r.completed, r.total)
	return n, err
}

func download(ctx context.Context, hc *http.Client, downloadURL, stage string, progress ProgressFunc) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "EasyProxy")
	resp, err := hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载 %s 失败: HTTP %d", downloadURL, resp.StatusCode)
	}
	var reader io.Reader = io.LimitReader(resp.Body, 500<<20)
	if progress != nil {
		progress(stage, 0, resp.ContentLength)
		reader = &progressReader{r: reader, total: resp.ContentLength, stage: stage, progress: progress}
	}
	return io.ReadAll(reader)
}

// Apply 下载最新版并安装到 dataDir/bin/easyproxy-{version}；成功后由调用方 exec 切换
func Apply(repo, current, dataDir, proxyAddr string, progress ProgressFunc) (*Release, error) {
	hc, err := newHTTPClient(proxyAddr)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if progress != nil {
		progress("checking", 0, 0)
	}
	rel, err := getLatest(ctx, repo, hc)
	if err != nil {
		return nil, err
	}
	latest := strings.TrimPrefix(rel.TagName, "v")
	if core.CompareSemver(current, latest) >= 0 {
		return nil, fmt.Errorf("当前已是最新版本 %s", current)
	}
	arch := runtime.GOARCH
	tarName := fmt.Sprintf("easyproxy-linux-%s.tar.gz", arch)
	tarURL := assetURL(rel, tarName)
	if tarURL == "" {
		return nil, fmt.Errorf("Release 中缺少资源 %s", tarName)
	}
	body, err := download(ctx, hc, tarURL, "downloading", progress)
	if err != nil {
		return nil, err
	}
	// sha256 校验（资产缺失则跳过）
	if sumURL := assetURL(rel, tarName+".sha256"); sumURL != "" {
		if progress != nil {
			progress("verifying", 0, 0)
		}
		if sum, err := download(ctx, hc, sumURL, "verifying", nil); err == nil {
			want := strings.Fields(string(sum))
			if len(want) > 0 {
				got := sha256.Sum256(body)
				if !strings.EqualFold(want[0], hex.EncodeToString(got[:])) {
					return nil, fmt.Errorf("sha256 校验失败")
				}
			}
		}
	}
	// 解包取二进制
	if progress != nil {
		progress("installing", 0, 0)
	}
	gz, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("安装包解压失败: %w", err)
	}
	tr := tar.NewReader(gz)
	var bin []byte
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if hdr.Typeflag == tar.TypeReg && hdr.Size > 1<<20 {
			if bin, err = io.ReadAll(tr); err != nil {
				return nil, err
			}
			break
		}
	}
	if bin == nil {
		return nil, fmt.Errorf("安装包中未找到二进制")
	}
	if err := os.MkdirAll(filepath.Join(dataDir, "bin"), 0o755); err != nil {
		return nil, err
	}
	target := filepath.Join(dataDir, "bin", "easyproxy-"+latest)
	if err := os.WriteFile(target, bin, 0o755); err != nil {
		return nil, err
	}
	Cleanup(dataDir, current)
	return rel, nil
}

var binVerRe = regexp.MustCompile(`easyproxy-v?(\d+\.\d+\.\d+)$`)

// Cleanup 只保留当前版本与最新一个已下载版本，其余删除
func Cleanup(dataDir, current string) {
	entries, err := os.ReadDir(filepath.Join(dataDir, "bin"))
	if err != nil {
		return
	}
	type item struct {
		path string
		ver  string
	}
	items := []item{}
	for _, e := range entries {
		if m := binVerRe.FindStringSubmatch(e.Name()); m != nil && !e.IsDir() {
			items = append(items, item{filepath.Join(dataDir, "bin", e.Name()), m[1]})
		}
	}
	// 按版本升序，保留最大的（新版）与等于 current 的
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			if core.CompareSemver(items[j].ver, items[i].ver) < 0 {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
	keep := map[string]bool{}
	if len(items) > 0 {
		keep[items[len(items)-1].path] = true
	}
	for _, it := range items {
		if it.ver == current {
			keep[it.path] = true
		}
	}
	for _, it := range items {
		if !keep[it.path] {
			_ = os.Remove(it.path)
		}
	}
}
