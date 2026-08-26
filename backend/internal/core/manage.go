package core

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
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
	CoreRepo                   = "MetaCubeX/mihomo"
	GitHubAPI                  = "https://api.github.com"
	GitHubRelease              = "https://github.com"
	FallbackVersion            = "v1.19.13"
	CoreDownloadSourceTimeout  = time.Minute
	CoreDownloadOverallTimeout = 5 * time.Minute
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

// CoreDownloadMirrors 内置内核下载镜像（形如 ghproxy 的 GitHub 加速前缀，按序自动尝试；空串=官方直连）。
// 加速镜像无需面板内核代理即可访问，优先于 GitHub 官方源。
var CoreDownloadMirrors = []string{
	"https://ghproxy.net/https://github.com",
	"https://gh-proxy.com/https://github.com",
	"https://ghfast.top/https://github.com",
	"",
}

// mirrorProxyPrefix 由镜像前缀推导通用 URL 代理前缀（如 https://ghproxy.net/）
func mirrorProxyPrefix(mirror string) string {
	return strings.TrimSuffix(strings.TrimRight(mirror, "/"), GitHubRelease)
}

// LatestCoreVersion 查询 mihomo 最新版本 tag：按内置下载源顺序依次尝试。
func LatestCoreVersion() (string, error) {
	var lastErr error
	for _, source := range coreDownloadSources("") {
		api := GitHubAPI
		if source.base != GitHubRelease {
			api = strings.TrimRight(mirrorProxyPrefix(source.base), "/") + "/" + GitHubAPI
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

// CoreDownloadAsset 是当前运行环境适用的 Mihomo 下载文件类型。
type CoreDownloadAsset struct {
	OS              string   `json:"os"`
	Architecture    string   `json:"architecture"`
	AssetArch       string   `json:"asset_arch"`
	Variant         string   `json:"variant"`
	Label           string   `json:"label"`
	Reason          string   `json:"reason"`
	MissingFeatures []string `json:"missing_features,omitempty"`
}

var amd64V3Features = []struct {
	label string
	flags []string
}{
	{label: "AVX", flags: []string{"avx"}},
	{label: "AVX2", flags: []string{"avx2"}},
	{label: "BMI1", flags: []string{"bmi1"}},
	{label: "BMI2", flags: []string{"bmi2"}},
	{label: "F16C", flags: []string{"f16c"}},
	{label: "FMA", flags: []string{"fma"}},
	{label: "LZCNT", flags: []string{"lzcnt", "abm"}},
	{label: "MOVBE", flags: []string{"movbe"}},
}

func cpuFlags(cpuInfo string) map[string]bool {
	flags := map[string]bool{}
	for _, line := range strings.Split(cpuInfo, "\n") {
		parts := strings.Fields(line)
		if len(parts) < 3 || !strings.EqualFold(parts[0], "flags") {
			continue
		}
		for _, flag := range parts[2:] {
			flags[strings.ToLower(flag)] = true
		}
	}
	return flags
}

func missingAMD64V3Features(flags map[string]bool) []string {
	missing := make([]string, 0)
	for _, feature := range amd64V3Features {
		supported := false
		for _, flag := range feature.flags {
			if flags[flag] {
				supported = true
				break
			}
		}
		if !supported {
			missing = append(missing, feature.label)
		}
	}
	return missing
}

func recommendedCoreDownloadAsset(goos, goarch, cpuInfo string) CoreDownloadAsset {
	assetArch, err := assetArch(goarch)
	if err != nil {
		return CoreDownloadAsset{
			OS:           goos,
			Architecture: goarch,
			Variant:      "unsupported",
			Label:        "不支持的架构",
			Reason:       err.Error(),
		}
	}
	asset := CoreDownloadAsset{
		OS:           goos,
		Architecture: goarch,
		AssetArch:    assetArch,
		Variant:      "standard",
		Label:        "标准版",
		Reason:       fmt.Sprintf("当前环境为 %s/%s，将使用标准内核", goos, goarch),
	}
	if goos != "linux" || goarch != "amd64" {
		return asset
	}

	flags := cpuFlags(cpuInfo)
	missing := missingAMD64V3Features(flags)
	if len(missing) == 0 {
		asset.Reason = "已检测到 AMD64 v3 指令集，将使用标准 AMD64 内核"
		return asset
	}
	asset.AssetArch = "amd64-compatible"
	asset.Variant = "compatible"
	asset.Label = "兼容版"
	asset.MissingFeatures = missing
	if len(flags) == 0 {
		asset.Reason = "无法读取 CPU 指令集，为保证可运行性将使用 AMD64 兼容版内核"
	} else {
		asset.Reason = fmt.Sprintf("CPU 缺少 AMD64 v3 指令集（%s），将使用 AMD64 兼容版内核", strings.Join(missing, "、"))
	}
	return asset
}

// RecommendedCoreDownloadAsset 检测当前 CPU 指令集并选择可运行的 Mihomo 内核文件。
// 普通 amd64 版本要求 AMD64 v3；不满足或无法检测时选择兼容版以避免下载后无法运行。
func RecommendedCoreDownloadAsset() CoreDownloadAsset {
	cpuInfo, _ := os.ReadFile("/proc/cpuinfo")
	return recommendedCoreDownloadAsset(runtime.GOOS, runtime.GOARCH, string(cpuInfo))
}

// DownloadProgress 是下载内核时的非敏感进度信息。Source 仅为显示名称，不包含完整 URL，
// 以避免自定义镜像地址中的认证参数写入操作日志。
type DownloadProgress struct {
	Stage   string
	Source  string
	Attempt int
	Total   int
	Version string
	Err     error
}

// CoreValidationError 保留内核可执行校验的诊断信息。它会被写入内核日志，
// 用于区分架构、CPU 指令集、动态库和数据目录执行权限等问题。
type CoreValidationError struct {
	OS       string
	Arch     string
	FileSize int
	Cause    error
	Output   string
	Hint     string
}

func (e *CoreValidationError) Error() string {
	message := fmt.Sprintf("内核校验失败（运行环境 %s/%s，文件大小 %.1f MiB）", e.OS, e.Arch, float64(e.FileSize)/(1<<20))
	if e.Hint != "" {
		message += "：" + e.Hint
	}
	if e.Cause != nil {
		message += "；执行错误：" + e.Cause.Error()
	}
	if e.Output != "" {
		message += "；内核输出：" + e.Output
	}
	return message
}

func (e *CoreValidationError) Unwrap() error { return e.Cause }

func compactCoreDiagnostic(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	const limit = 500
	if len(value) > limit {
		return value[:limit] + "…"
	}
	return value
}

func coreValidationHint(cause error, output string) string {
	message := strings.ToLower(compactCoreDiagnostic(fmt.Sprintf("%v %s", cause, output)))
	switch {
	case errors.Is(cause, context.DeadlineExceeded):
		return "执行内核版本检查超时"
	case strings.Contains(message, "illegal instruction"):
		return "CPU 指令集不兼容，可尝试 linux-amd64-compatible 内核"
	case strings.Contains(message, "exec format error"):
		return "二进制架构或文件格式不匹配"
	case strings.Contains(message, "permission denied") || strings.Contains(message, "operation not permitted"):
		return "数据目录无执行权限，或宿主机以 noexec 方式挂载"
	case strings.Contains(message, "no such file or directory") || strings.Contains(message, "not found"):
		return "可能缺少动态库或二进制解释器"
	case cause == nil:
		return "版本输出未识别为 Mihomo"
	default:
		return "无法执行为 Mihomo 内核"
	}
}

type coreDownloadSource struct {
	base  string
	label string
}

// coreDownloadSources 按自定义镜像、内置加速镜像、GitHub 官方源的顺序整理下载源。
func coreDownloadSources(mirror string) []coreDownloadSource {
	candidates := make([]coreDownloadSource, 0, len(CoreDownloadMirrors)+1)
	if m := strings.TrimSpace(mirror); m != "" {
		candidates = append(candidates, coreDownloadSource{base: strings.TrimRight(m, "/"), label: "自定义镜像"})
	}
	mirrorNumber := 0
	for _, base := range CoreDownloadMirrors {
		label := "GitHub 官方源"
		if base != "" {
			mirrorNumber++
			label = fmt.Sprintf("内置镜像 %d", mirrorNumber)
		}
		candidates = append(candidates, coreDownloadSource{base: base, label: label})
	}

	seen := map[string]bool{}
	sources := make([]coreDownloadSource, 0, len(candidates))
	for _, candidate := range candidates {
		base := strings.TrimRight(candidate.base, "/")
		if base == "" {
			base = GitHubRelease
		}
		if seen[base] {
			continue
		}
		seen[base] = true
		candidate.base = base
		sources = append(sources, candidate)
	}
	return sources
}

func reportDownloadProgress(progress func(DownloadProgress), update DownloadProgress) {
	if progress != nil {
		progress(update)
	}
}

// DownloadCore 下载并安装内核。多个下载源按序自动尝试：用户镜像（若有）→ 内置镜像 → 官方源；
// mirror 为 GitHub 下载前缀（如 https://ghproxy.net/https://github.com），空则不额外优先。
func DownloadCore(dataDir, version, mirror string) error {
	return DownloadCoreWithProgress(dataDir, version, mirror, nil)
}

// DownloadCoreWithProgress 下载并安装内核，并在每个源尝试与失败时报告进度。
// 单源最多等待一分钟，所有源合计最多等待五分钟，避免网络不可达时长时间没有反馈。
func DownloadCoreWithProgress(dataDir, version, mirror string, progress func(DownloadProgress)) error {
	if version == "" || version == "latest" {
		reportDownloadProgress(progress, DownloadProgress{Stage: "resolving_version"})
		v, err := LatestCoreVersion()
		if err != nil {
			v = FallbackVersion
			reportDownloadProgress(progress, DownloadProgress{Stage: "using_fallback_version", Version: v, Err: err})
		} else {
			reportDownloadProgress(progress, DownloadProgress{Stage: "resolved_version", Version: v})
		}
		version = v
	}
	asset := RecommendedCoreDownloadAsset()
	if asset.Variant == "unsupported" {
		return fmt.Errorf("%s", asset.Reason)
	}

	sources := coreDownloadSources(mirror)

	deadline := time.Now().Add(CoreDownloadOverallTimeout)
	var lastErr error
	for i, source := range sources {
		if time.Now().After(deadline) {
			break
		}
		u := fmt.Sprintf("%s/%s/releases/download/%s/mihomo-linux-%s-%s.gz",
			source.base, CoreRepo, version, asset.AssetArch, version)
		update := DownloadProgress{Source: source.label, Attempt: i + 1, Total: len(sources), Version: version}
		reportDownloadProgress(progress, DownloadProgress{Stage: "attempt", Source: update.Source, Attempt: update.Attempt, Total: update.Total, Version: update.Version})
		log.Printf("[core] 尝试下载源: %s", u)
		data, err := fetchCoreAsset(u)
		if err != nil {
			lastErr = err
			log.Printf("[core] 该源失败: %v", err)
			update.Stage, update.Err = "failed", err
			reportDownloadProgress(progress, update)
			continue
		}
		if err := installCoreBytes(dataDir, data); err != nil {
			update.Stage, update.Err = "verification_failed", err
			reportDownloadProgress(progress, update)
			return fmt.Errorf("%s 返回的内核无法通过校验: %w", source.label, err)
		}
		update.Stage = "completed"
		reportDownloadProgress(progress, update)
		return nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("下载总时限 %s 已到", CoreDownloadOverallTimeout)
	}
	return fmt.Errorf("全部下载源失败，最后错误: %w", lastErr)
}

// fetchCoreAsset 从单个源下载内核压缩包。
func fetchCoreAsset(u string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), CoreDownloadSourceTimeout)
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
		out, err := exec.CommandContext(ctx, tmp, "-v").CombinedOutput()
		if err != nil || !bytes.Contains(out, []byte("Mihomo")) {
			os.Remove(tmp)
			return &CoreValidationError{
				OS:       runtime.GOOS,
				Arch:     runtime.GOARCH,
				FileSize: len(data),
				Cause:    err,
				Output:   compactCoreDiagnostic(string(out)),
				Hint:     coreValidationHint(err, string(out)),
			}
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
