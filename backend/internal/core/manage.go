package core

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

const (
	CoreRepo        = "MetaCubeX/mihomo"
	GitHubAPI       = "https://api.github.com"
	GitHubRelease   = "https://github.com"
	FallbackVersion = "v1.19.13"
)

func CorePath(dataDir string) string { return filepath.Join(dataDir, "core", "mihomo") }

// InstalledCoreVersion 执行 mihomo -v 解析版本；不存在返回空
func InstalledCoreVersion(dataDir string) string {
	p := CorePath(dataDir)
	if _, err := os.Stat(p); err != nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, p, "-v").Output()
	if err != nil {
		return "unknown"
	}
	ver := strings.TrimSpace(string(out))
	if i := strings.IndexByte(ver, '\n'); i > 0 {
		ver = ver[:i]
	}
	return ver
}

// CoreDownloadMirrors 内置内核下载镜像（形如 ghproxy 的 GitHub 加速前缀，按序自动尝试；空串=直连）
var CoreDownloadMirrors = []string{
	"",
	"https://ghproxy.net/https://github.com",
	"https://gh-proxy.com/https://github.com",
	"https://ghfast.top/https://github.com",
}

// mirrorProxyPrefix 由镜像前缀推导通用 URL 代理前缀（如 https://ghproxy.net/）
func mirrorProxyPrefix(mirror string) string {
	return strings.TrimSuffix(strings.TrimRight(mirror, "/"), GitHubRelease)
}

// LatestCoreVersion 查询 mihomo 最新版本 tag：直连失败时依次尝试内置镜像
func LatestCoreVersion() (string, error) {
	prefixes := []string{""}
	for _, m := range CoreDownloadMirrors[1:] {
		prefixes = append(prefixes, mirrorProxyPrefix(m))
	}
	var lastErr error
	for _, prefix := range prefixes {
		api := GitHubAPI
		if prefix != "" {
			api = prefix + "/" + GitHubAPI
		}
		if v, err := latestVersionFrom(api); err == nil {
			return v, nil
		} else {
			lastErr = err
		}
	}
	return "", lastErr
}

func latestVersionFrom(apiBase string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+"/repos/"+CoreRepo+"/releases/latest", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var out struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.TagName == "" {
		return "", fmt.Errorf("未获取到版本号")
	}
	return out.TagName, nil
}

func assetArch(goarch string) (string, error) {
	switch goarch {
	case "amd64":
		return "amd64", nil
	case "arm64":
		return "arm64", nil
	case "arm":
		return "armv7", nil
	case "386":
		return "386", nil
	}
	return "", fmt.Errorf("不支持的架构: %s", goarch)
}

// DownloadCore 下载并安装内核。多个下载源按序自动尝试：用户镜像（若有）→ 内置镜像 → 直连；
// mirror 为 GitHub 下载前缀（如 https://ghproxy.net/https://github.com），空则不额外优先
func DownloadCore(dataDir, version, mirror string) error {
	if version == "" || version == "latest" {
		v, err := LatestCoreVersion()
		if err != nil {
			v = FallbackVersion
		}
		version = v
	}
	arch, err := assetArch(runtime.GOARCH)
	if err != nil {
		return err
	}

	bases := []string{}
	if m := strings.TrimSpace(mirror); m != "" {
		bases = append(bases, strings.TrimRight(m, "/"))
	}
	bases = append(bases, CoreDownloadMirrors...)
	seen := map[string]bool{}
	urls := make([]string, 0, len(bases))
	for _, base := range bases {
		if base == "" {
			base = GitHubRelease
		} else {
			base = strings.TrimRight(base, "/")
		}
		if seen[base] {
			continue
		}
		seen[base] = true
		urls = append(urls, fmt.Sprintf("%s/%s/releases/download/%s/mihomo-linux-%s-%s.gz",
			base, CoreRepo, version, arch, version))
	}

	deadline := time.Now().Add(20 * time.Minute)
	var lastErr error
	for _, u := range urls {
		if time.Now().After(deadline) {
			break
		}
		log.Printf("[core] 尝试下载源: %s", u)
		data, err := fetchCoreAsset(u)
		if err != nil {
			lastErr = err
			log.Printf("[core] 该源失败: %v", err)
			continue
		}
		return installCoreBytes(dataDir, data)
	}
	return fmt.Errorf("全部下载源失败，最后错误: %w", lastErr)
}

// fetchCoreAsset 从单个源下载内核压缩包（单源 5 分钟超时）
func fetchCoreAsset(u string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d (%s)", resp.StatusCode, u)
	}
	gz, err := gzip.NewReader(io.LimitReader(resp.Body, 200<<20))
	if err != nil {
		return nil, err
	}
	return io.ReadAll(gz)
}

// InstallCoreFromUpload 用户手动上传的内核文件（裸二进制或 .gz）
func InstallCoreFromUpload(dataDir, filename string, r io.Reader) error {
	data, err := io.ReadAll(io.LimitReader(r, 200<<20))
	if err != nil {
		return err
	}
	if strings.HasSuffix(strings.ToLower(filename), ".gz") {
		gz, err := gzip.NewReader(bytes.NewReader(data))
		if err != nil {
			return err
		}
		if data, err = io.ReadAll(gz); err != nil {
			return err
		}
	} else if strings.HasSuffix(strings.ToLower(filename), ".tar.gz") || strings.HasSuffix(strings.ToLower(filename), ".tgz") {
		tr := tar.NewReader(bytes.NewReader(data))
		for {
			hdr, err := tr.Next()
			if err == io.EOF {
				return fmt.Errorf("压缩包内未找到二进制")
			}
			if err != nil {
				return err
			}
			if hdr.Typeflag == tar.TypeReg && hdr.Size > 1<<20 {
				data, err = io.ReadAll(tr)
				if err != nil {
					return err
				}
				break
			}
		}
	}
	return installCoreBytes(dataDir, data)
}

func installCoreBytes(dataDir string, data []byte) error {
	if len(data) < 1<<20 {
		return fmt.Errorf("文件过小，疑似不是有效内核（%d 字节）", len(data))
	}
	dir := filepath.Join(dataDir, "core")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(dir, ".mihomo.tmp")
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return err
	}
	// 非 Linux 开发环境跳过可执行校验（无法运行 Linux 二进制）
	if runtime.GOOS == "linux" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, tmp, "-v").Output()
		if err != nil || !bytes.Contains(out, []byte("Mihomo")) {
			os.Remove(tmp)
			return fmt.Errorf("内核校验失败，文件可能不适用于当前平台")
		}
	}
	final := CorePath(dataDir)
	if err := os.Remove(final); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(tmp, final)
}

var verRe = regexp.MustCompile(`v?(\d+)\.(\d+)\.(\d+)`)

// CompareSemver 比较 vX.Y.Z：a<b 返回 -1，相等 0，a>b 返回 1
func CompareSemver(a, b string) int {
	pa, pb := verRe.FindStringSubmatch(a), verRe.FindStringSubmatch(b)
	if pa == nil || pb == nil {
		return strings.Compare(a, b)
	}
	for i := 1; i <= 3; i++ {
		x, y := atoi(pa[i]), atoi(pb[i])
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return n
		}
		n = n*10 + int(c-'0')
	}
	return n
}
