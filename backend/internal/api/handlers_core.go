package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"easyproxy/internal/core"
	"easyproxy/internal/parser"
	"easyproxy/internal/service"
	"easyproxy/internal/update"
)

// ---------- meta / regions ----------

func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	st := s.mgr.Status()
	writeJSON(w, http.StatusOK, map[string]any{
		"version": s.version,
		"system":  s.systemInfo(),
		"core": map[string]any{
			"installed":    s.coreInstalled(),
			"version":      core.InstalledCoreVersion(s.dataDir),
			"state":        st.State,
			"pid":          st.PID,
			"memory_bytes": st.MemoryBytes,
			"restarts":     st.Restarts,
			"last_error":   st.LastError,
		},
	})
}

func (s *Server) systemInfo() map[string]any {
	commit, buildTime := buildMetadata()
	buildType := "正式发布"
	if strings.TrimSpace(s.version) == "" || s.version == "dev" {
		buildType = "开发构建"
	}
	return map[string]any{
		"release_repo": DefaultUpdateRepo,
		"commit":       commit,
		"build_type":   buildType,
		"build_time":   buildTime,
		"deployment":   deploymentMode(),
		"go_version":   runtime.Version(),
		"architecture": runtime.GOOS + "/" + runtime.GOARCH,
		"timezone":     time.Now().Location().String(),
	}
}

func buildMetadata() (commit, buildTime string) {
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range info.Settings {
			switch setting.Key {
			case "vcs.revision":
				commit = setting.Value
				if len(commit) > 7 {
					commit = commit[:7]
				}
			case "vcs.time":
				buildTime = setting.Value
			}
		}
	}
	if buildTime == "" {
		if executable, err := os.Executable(); err == nil {
			if info, err := os.Stat(executable); err == nil {
				buildTime = info.ModTime().UTC().Format(time.RFC3339)
			}
		}
	}
	return commit, buildTime
}

func deploymentMode() string {
	if runtime.GOOS == "linux" {
		if _, err := os.Stat("/.dockerenv"); err == nil {
			return "Docker 容器"
		}
		if data, err := os.ReadFile("/proc/1/cgroup"); err == nil {
			cgroup := strings.ToLower(string(data))
			if strings.Contains(cgroup, "docker") || strings.Contains(cgroup, "containerd") || strings.Contains(cgroup, "kubepods") {
				return "容器环境"
			}
		}
	}
	return "本地运行"
}

func (s *Server) coreInstalled() bool {
	_, err := os.Stat(core.CorePath(s.dataDir))
	return err == nil
}

func (s *Server) handleRegions(w http.ResponseWriter, r *http.Request) {
	out := []map[string]any{}
	for _, reg := range parser.Regions {
		out = append(out, map[string]any{"code": reg.Code, "flag": reg.Flag, "cn": reg.CN})
	}
	out = append(out, map[string]any{"code": parser.RegionOther, "flag": "🌐", "cn": "其他"})
	writeJSON(w, http.StatusOK, out)
}

// ---------- 内核管理 ----------

// runTunEnvironmentCheck 是唯一的 TUN 启用预检入口。保留变量形式以便接口测试
// 覆盖“设备存在但 auto-redirect 不可用”的场景，而无需依赖测试机网络命名空间。
var runTunEnvironmentCheck = core.CheckTun

func (s *Server) handleCoreStatus(w http.ResponseWriter, r *http.Request) {
	st := s.mgr.Status()
	s.dlMu.Lock()
	dlRunning, dlErr := s.dlRunning, s.dlErr
	s.dlMu.Unlock()

	latest := ""
	if time.Since(s.latestCacheAt) > 10*time.Minute {
		if v, err := core.LatestCoreVersion(); err == nil {
			s.latestCacheAt = time.Now()
			s.latestCache = v
		}
	}
	s.dlMu.Lock()
	latest = s.latestCache
	s.dlMu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"installed":         s.coreInstalled(),
		"installed_version": core.InstalledCoreVersion(s.dataDir),
		"state":             st.State,
		"pid":               st.PID,
		"memory_bytes":      st.MemoryBytes,
		"restarts":          st.Restarts,
		"last_error":        st.LastError,
		"tun_active":        st.TunActive,
		"tun_error":         st.TunError,
		"downloading":       dlRunning,
		"download_error":    dlErr,
		"latest_version":    latest,
		"download_asset":    core.RecommendedCoreDownloadAsset(),
	})
}

func (s *Server) handleCoreLogs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.mgr.RecentLogs())
}

// coreDownloadProgress 将下载过程写入持久化内核日志。来源名称由 core 层提供，
// 不含用户自定义镜像的完整 URL，避免意外记录认证信息。
func (s *Server) coreDownloadProgress(eventPrefix string) func(core.DownloadProgress) {
	return func(update core.DownloadProgress) {
		details := map[string]any{}
		if update.Version != "" {
			details["version"] = update.Version
		}
		if update.Source != "" {
			details["source"] = update.Source
			details["attempt"] = update.Attempt
			details["total"] = update.Total
		}
		if update.Err != nil {
			details["error"] = safeCoreAuditError(update.Err)
		}

		event := eventPrefix + "." + update.Stage
		summary, level := "", "info"
		switch update.Stage {
		case "resolving_version":
			summary = "正在查询 Mihomo 最新内核版本"
		case "resolved_version":
			summary = "已获取 Mihomo 最新内核版本"
		case "using_fallback_version":
			summary, level = "获取最新版本失败，改用内置稳定版本", "warning"
		case "attempt":
			summary = fmt.Sprintf("正在尝试下载 Mihomo 内核（%s，%d/%d）", update.Source, update.Attempt, update.Total)
		case "failed":
			summary, level = fmt.Sprintf("Mihomo 内核下载源失败，准备切换下一源（%s，%d/%d）", update.Source, update.Attempt, update.Total), "warning"
		case "verification_failed":
			summary, level = fmt.Sprintf("Mihomo 内核校验失败（%s，%d/%d）", update.Source, update.Attempt, update.Total), "error"
		case "completed":
			summary, level = "Mihomo 内核下载并校验完成", "success"
		default:
			return
		}
		s.audit("core", event, level, summary, details)
	}
}

func (s *Server) handleCoreDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Version string `json:"version"`
	}
	_ = readJSON(r, &req)

	s.dlMu.Lock()
	if s.dlRunning {
		s.dlMu.Unlock()
		s.audit("core", "core.download", "warning", "内核下载未启动：已有任务进行中", nil)
		writeErr(w, http.StatusConflict, "已有下载任务进行中")
		return
	}
	s.dlRunning, s.dlErr = true, ""
	s.dlMu.Unlock()
	s.audit("core", "core.download", "info", "已开始下载 Mihomo 内核", map[string]any{"version": strings.TrimSpace(req.Version)})

	go func() {
		defer func() {
			s.dlMu.Lock()
			s.dlRunning = false
			s.dlMu.Unlock()
		}()
		mirror := s.st.GetSetting("core_mirror", "")
		ver := req.Version
		log.Printf("[core] 开始下载内核 ver=%s mirror=%s", ver, mirror)
		if err := core.DownloadCoreWithProgress(s.dataDir, ver, mirror, s.coreDownloadProgress("core.download")); err != nil {
			s.dlMu.Lock()
			s.dlErr = err.Error()
			s.dlMu.Unlock()
			log.Printf("[core] 内核下载失败: %v", err)
			s.audit("core", "core.download", "error", "Mihomo 内核下载失败", map[string]any{"version": strings.TrimSpace(ver), "error": safeCoreAuditError(err)})
			return
		}
		log.Printf("[core] 内核下载完成，重启内核")
		s.writeGeneratedConfig()
		if err := s.mgr.Restart(); err != nil {
			s.audit("core", "core.download", "warning", "Mihomo 内核下载完成，但重启失败", map[string]any{"version": strings.TrimSpace(ver), "error": safeAuditError(err)})
			return
		}
		s.audit("core", "core.download", "success", "Mihomo 内核下载并启动完成", map[string]any{"version": strings.TrimSpace(ver)})
		s.refreshRecognitionRuleProvidersAfterCoreStart()
	}()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "下载任务已开始"})
}

func (s *Server) handleCoreUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(200 << 20); err != nil {
		s.audit("core", "core.upload", "error", "内核文件上传失败", map[string]any{"error": safeAuditError(err)})
		writeErr(w, http.StatusBadRequest, "上传失败: "+err.Error())
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		s.audit("core", "core.upload", "error", "内核文件上传失败：缺少文件", nil)
		writeErr(w, http.StatusBadRequest, "缺少文件字段 file")
		return
	}
	defer file.Close()
	if err := core.InstallCoreFromUpload(s.dataDir, hdr.Filename, file); err != nil {
		s.audit("core", "core.upload", "error", "内核文件安装失败", map[string]any{"file": hdr.Filename, "error": safeCoreAuditError(err)})
		writeErr(w, http.StatusBadRequest, "安装失败: "+err.Error())
		return
	}
	s.writeGeneratedConfig()
	if err := s.mgr.Restart(); err != nil {
		s.audit("core", "core.upload", "warning", "内核文件上传完成，但重启失败", map[string]any{"file": hdr.Filename, "error": safeAuditError(err)})
		writeErr(w, http.StatusInternalServerError, "内核重启失败: "+err.Error())
		return
	}
	s.audit("core", "core.upload", "success", "内核文件上传并启动完成", map[string]any{"file": hdr.Filename})
	s.refreshRecognitionRuleProvidersAfterCoreStart()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleCoreRestart(w http.ResponseWriter, r *http.Request) {
	if !s.coreInstalled() {
		s.audit("core", "core.restart", "warning", "内核重启失败：内核未安装", nil)
		writeErr(w, http.StatusBadRequest, "内核未安装")
		return
	}
	s.writeGeneratedConfig()
	if err := s.mgr.Restart(); err != nil {
		s.audit("core", "core.restart", "error", "内核重启失败", map[string]any{"error": safeAuditError(err)})
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.audit("core", "core.restart", "success", "Mihomo 内核已重启", nil)
	s.refreshRecognitionRuleProvidersAfterCoreStart()
	if s.appliedTunEnabled() {
		s.verifyTunAfterStart()
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleTunCheck 开启 TUN 前的环境预检（/dev/net/tun + NET_ADMIN + auto-redirect 依赖）
func (s *Server) handleTunCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, runTunEnvironmentCheck())
}

// tunDeviceName mihomo 未显式配置 tun.device 时的默认 TUN 接口名
const tunDeviceName = "Meta"

// verifyTunAfterStart 异步验证内核启动后 TUN 接口是否真的创建。
// 内核进程存活不代表 TUN 生效：auto-redirect 初始化失败时 mihomo 仅记录一条
// error 后继续运行，状态灯不变，必须以接口存在性做最终确认。
func (s *Server) verifyTunAfterStart() {
	go func() {
		active := false
		for i := 0; i < 6; i++ {
			time.Sleep(500 * time.Millisecond)
			if tunInterfaceExists(tunDeviceName) {
				active = true
				break
			}
		}
		if active {
			s.mgr.SetTunVerifyResult(true, "")
			s.audit("core", "core.tun_verify", "success", "TUN 接口已就绪，透明代理生效", nil)
			return
		}
		reason := tunFailureReason(s.mgr.RecentLogs())
		s.mgr.SetTunVerifyResult(false, reason)
		summary := "TUN 接口未创建，透明代理未生效"
		if reason != "" {
			summary += "：" + reason
		}
		s.audit("core", "core.tun_verify", "error", summary, nil)
	}()
}

func tunInterfaceExists(name string) bool {
	ifaces, err := net.Interfaces()
	if err != nil {
		return false
	}
	for _, ifc := range ifaces {
		if ifc.Name == name {
			return true
		}
	}
	return false
}

// tunFailureReason 从内核最近输出中提取 TUN 失败原因：
// 优先取包含 "tun" 的 error 行（如 Start TUN listening error），否则取第一条 error 行。
func tunFailureReason(logs []string) string {
	first := ""
	for _, line := range logs {
		if coreOutputLevel(line) != "error" {
			continue
		}
		cleaned := sanitizeCoreOutput(line)
		if strings.Contains(strings.ToLower(line), "tun") {
			return cleaned
		}
		if first == "" {
			first = cleaned
		}
	}
	return first
}

// appliedTunEnabled 已应用配置快照中 TUN 是否开启（重启类入口的验证条件）
func (s *Server) appliedTunEnabled() bool {
	values, err := s.st.AppliedConfigSettings()
	if err != nil {
		return false
	}
	return configBool(values, "tun_enable", false)
}

// ---------- 面板自更新 ----------

// DefaultUpdateRepo 内置更新源：本项目官方仓库
const DefaultUpdateRepo = "zorohasaky/easyproxy"

// updateRepo 始终使用项目官方发布仓库，避免面板升级被自定义来源劫持。
func (s *Server) updateRepo() string {
	return DefaultUpdateRepo
}

// updateProxyAddr 面板更新固定直连，不再支持经本地 Mihomo 代理下载。
func (s *Server) updateProxyAddr() string { return "" }

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, update.Check(s.updateRepo(), s.version, s.updateProxyAddr()))
}

func (s *Server) setUpdateProgress(stage string, completed, total int64) {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	s.updateTask.State = stage
	s.updateTask.Completed = completed
	s.updateTask.Total = total
	s.updateTask.Percent = 0
	if total > 0 && completed > 0 {
		s.updateTask.Percent = int(completed * 100 / total)
		if s.updateTask.Percent > 100 {
			s.updateTask.Percent = 100
		}
	}
}

func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	s.updateMu.Lock()
	status := s.updateTask
	s.updateMu.Unlock()
	if status.State == "" {
		status.State = "idle"
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	proxy := s.updateProxyAddr()
	s.updateMu.Lock()
	if s.updateTask.Running {
		s.updateMu.Unlock()
		s.audit("operation", "panel.update", "warning", "面板版本升级未启动：已有任务进行中", nil)
		writeErr(w, http.StatusConflict, "更新任务正在进行中")
		return
	}
	s.updateTask = updateTaskStatus{State: "checking", Running: true, ViaProxy: proxy != ""}
	s.updateMu.Unlock()

	repo := s.updateRepo()
	s.audit("operation", "panel.update", "info", "已开始下载面板版本升级", nil)
	go func() {
		rel, err := update.Apply(repo, s.version, s.dataDir, proxy, s.setUpdateProgress)
		if err != nil {
			s.updateMu.Lock()
			s.updateTask.State = "error"
			s.updateTask.Running = false
			s.updateTask.Error = err.Error()
			s.updateMu.Unlock()
			s.audit("operation", "panel.update", "error", "面板版本升级下载失败", map[string]any{"error": safeAuditError(err)})
			return
		}
		version := strings.TrimPrefix(rel.TagName, "v")
		s.updateMu.Lock()
		s.updateTask.State = "ready"
		s.updateTask.Running = false
		s.updateTask.Version = version
		s.updateTask.Percent = 100
		s.updateTask.Error = ""
		s.updateMu.Unlock()
		s.audit("operation", "panel.update", "success", "面板版本升级已下载完成，等待重启", map[string]any{"version": version})
	}()
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "message": "更新任务已在后台启动"})
}

func (s *Server) handleUpdateRestart(w http.ResponseWriter, r *http.Request) {
	s.updateMu.Lock()
	if s.updateTask.State != "ready" || s.updateTask.Version == "" {
		s.updateMu.Unlock()
		s.audit("operation", "panel.update_restart", "warning", "面板升级重启未执行：尚无已完成更新", nil)
		writeErr(w, http.StatusConflict, "尚无已下载完成的更新")
		return
	}
	s.updateTask.State = "restarting"
	s.updateTask.Running = true
	s.updateTask.Error = ""
	s.updateMu.Unlock()
	s.audit("operation", "panel.update_restart", "info", "面板升级重启已开始", nil)

	go func() {
		// 先让 HTTP 响应返回给前端，再切换当前进程。
		time.Sleep(time.Second)
		_ = s.mgr.Stop()
		update.ExecNewest(s.dataDir, s.version)
		// Exec 成功时不会返回；返回说明当前平台不支持或切换失败。
		_ = s.mgr.Start()
		s.updateMu.Lock()
		s.updateTask.State = "ready"
		s.updateTask.Running = false
		s.updateTask.Error = "自动重启失败，请手动重启应用完成更新"
		s.updateMu.Unlock()
		s.audit("operation", "panel.update_restart", "error", "面板升级自动重启失败", nil)
	}()
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "message": "应用正在重启"})
}

// ---------- 设置 ----------

type settingsPayload struct {
	MixedPort         *int                `json:"mixed_port"`
	AllowLan          *bool               `json:"allow_lan"`
	LogLevel          *string             `json:"log_level"`
	TunEnable         *bool               `json:"tun_enable"`
	TunStack          *string             `json:"tun_stack"`
	DnsEnable         *bool               `json:"dns_enable"`
	DnsMode           *string             `json:"dns_mode"`
	DnsNameserver     []string            `json:"dns_nameserver"`
	DnsFallback       []string            `json:"dns_fallback"`
	GeoEnabled        *bool               `json:"geo_enabled"`
	GeoAutoUpdate     *bool               `json:"geo_auto_update"`
	GeoUpdateInterval *int                `json:"geo_update_interval"`
	GeoxUrls          map[string][]string `json:"geox_urls"`
	CoreMirror        *string             `json:"core_mirror"`
}

func (s *Server) handleGeoDataStatus(w http.ResponseWriter, r *http.Request) {
	coreRunning := s.mgr.Status().State == core.StateRunning
	sources, enabled, err := s.appliedGeoSettings()
	if err != nil {
		// 状态查询不能因已应用快照读取异常而整体失败；降级展示已保存设置，
		// 但手动刷新仍会拒绝使用这份不确定的配置。
		sources = service.GeoxSources(s.st)
		enabled = s.st.GetSettingBool("geo_enabled", true)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":      enabled,
		"core_running": coreRunning,
		"items": service.GeoDataStatuses(
			s.dataDir,
			sources,
			enabled,
			coreRunning,
		),
	})
}

func (s *Server) appliedGeoSettings() (map[string][]string, bool, error) {
	values, err := s.st.AppliedConfigSettings()
	if err != nil {
		return nil, false, err
	}
	return service.GeoxSourcesFromRaw(values["geox_urls"]), configBool(values, "geo_enabled", true), nil
}

// geoDataKindsWithoutActiveRules 找出当前内核配置不会自动初始化的 Geo 数据类型。
// Mihomo 只有在实际配置中出现 GEOIP/GEOSITE 规则时才会下载对应数据；这里让
// 用户主动点击“手动更新”时仍能把两个数据库完整落盘。
func (s *Server) geoDataKindsWithoutActiveRules() ([]string, error) {
	recognitionRules, err := s.st.ListRecognitionRules()
	if err != nil {
		return nil, err
	}
	outboundRules, err := s.st.ListOutboundRules()
	if err != nil {
		return nil, err
	}
	outboundEnabled := make(map[int64]bool, len(outboundRules))
	for _, outbound := range outboundRules {
		outboundEnabled[outbound.RecognitionID] = outbound.Enabled
	}
	active := map[string]bool{}
	for _, rule := range recognitionRules {
		if !rule.Enabled || !outboundEnabled[rule.ID] {
			continue
		}
		switch strings.ToUpper(rule.Kind) {
		case "GEOIP":
			active["geoip"] = true
		case "GEOSITE":
			active["geosite"] = true
		}
	}
	keys := make([]string, 0, 2)
	for _, key := range []string{"geoip", "geosite"} {
		if !active[key] {
			keys = append(keys, key)
		}
	}
	return keys, nil
}

func missingGeoDataKinds(items []service.GeoDataStatus) []string {
	byKey := make(map[string]service.GeoDataStatus, len(items))
	for _, item := range items {
		byKey[item.Key] = item
	}
	missing := make([]string, 0, 2)
	for _, key := range []string{"geoip", "geosite"} {
		item, ok := byKey[key]
		if !ok || (item.State != "loaded" && item.State != "ready") {
			missing = append(missing, key)
		}
	}
	return missing
}

func appendUniqueStrings(values []string, candidates ...string) []string {
	seen := make(map[string]bool, len(values)+len(candidates))
	for _, value := range values {
		seen[value] = true
	}
	for _, value := range candidates {
		if !seen[value] {
			values = append(values, value)
			seen[value] = true
		}
	}
	return values
}

// handleRefreshGeoData 先请求运行中的 Mihomo 刷新已启用数据库；若配置中没有
// GEOIP/GEOSITE 规则，Mihomo 会成功返回但不下载文件，因此再由面板按同一份
// 已应用数据源补齐缺失或未初始化的数据库。
// 未应用的 Geo 数据源仍保留在顶栏待应用清单中，不会被此次刷新提前使用。
func (s *Server) handleRefreshGeoData(w http.ResponseWriter, r *http.Request) {
	if !s.st.GetSettingBool("geo_enabled", true) {
		s.audit("operation", "geo.refresh", "warning", "Geo 数据库刷新未执行：功能已禁用", nil)
		writeErr(w, http.StatusBadRequest, "Geo 数据库已禁用，请先启用并应用配置")
		return
	}
	sources, enabled, err := s.appliedGeoSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取当前生效 Geo 配置失败: "+err.Error())
		return
	}
	if !enabled {
		s.audit("operation", "geo.refresh", "warning", "Geo 数据库刷新未执行：当前生效配置未启用", nil)
		writeErr(w, http.StatusConflict, "当前生效配置未启用 Geo 数据，请先应用设置")
		return
	}
	if s.mgr.Status().State != core.StateRunning {
		s.audit("operation", "geo.refresh", "warning", "Geo 数据库刷新未执行：内核未运行", nil)
		writeErr(w, http.StatusConflict, "内核未运行，无法刷新 Geo 数据库")
		return
	}
	if err := s.client.UpdateGeoDatabases(); err != nil {
		s.audit("operation", "geo.refresh", "error", "Geo 数据库刷新失败", map[string]any{"error": safeAuditError(err)})
		writeErr(w, http.StatusBadGateway, "刷新 Geo 数据库失败: "+err.Error())
		return
	}

	keys, err := s.geoDataKindsWithoutActiveRules()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取 Geo 识别规则失败: "+err.Error())
		return
	}
	statuses := service.GeoDataStatuses(s.dataDir, sources, enabled, true)
	keys = appendUniqueStrings(keys, missingGeoDataKinds(statuses)...)
	downloaded, err := service.RefreshGeoDataFiles(s.dataDir, sources, keys, s.runningCoreProxyAddr())
	if err != nil {
		s.audit("operation", "geo.refresh", "error", "Geo 数据库刷新失败", map[string]any{"error": safeAuditError(err)})
		writeErr(w, http.StatusBadGateway, "刷新 Geo 数据库失败: "+err.Error())
		return
	}

	statuses = service.GeoDataStatuses(s.dataDir, sources, enabled, true)
	if missing := missingGeoDataKinds(statuses); len(missing) > 0 {
		err := fmt.Errorf("%s 文件未就绪", strings.Join(missing, "、"))
		s.audit("operation", "geo.refresh", "error", "Geo 数据库刷新后文件仍未就绪", map[string]any{"error": safeAuditError(err)})
		writeErr(w, http.StatusBadGateway, "刷新 Geo 数据库失败: "+err.Error())
		return
	}
	refreshed := make([]string, 0, len(downloaded))
	for _, item := range downloaded {
		refreshed = append(refreshed, item.Name)
	}
	message := "Geo 数据库已按当前生效配置刷新"
	if len(refreshed) > 0 {
		message += "，已补齐 " + strings.Join(refreshed, "、")
	}
	s.audit("operation", "geo.refresh", "success", "Geo 数据库已刷新", map[string]any{"files": refreshed})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": message})
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	ns := []string{}
	if !s.st.GetSettingJSON("dns_nameserver", &ns) || len(ns) == 0 {
		ns = service.DefaultNameservers()
	}
	fb := []string{}
	if !s.st.GetSettingJSON("dns_fallback", &fb) || len(fb) == 0 {
		fb = service.DefaultFallbackDNS()
	}
	geox := service.GeoxSources(s.st)
	writeJSON(w, http.StatusOK, map[string]any{
		"mixed_port":          s.st.GetSettingInt("mixed_port", 7890),
		"allow_lan":           s.st.GetSettingBool("allow_lan", true),
		"log_level":           s.st.GetSetting("log_level", "info"),
		"tun_enable":          s.st.GetSettingBool("tun_enable", false),
		"tun_stack":           s.st.GetSetting("tun_stack", "mixed"),
		"dns_enable":          s.st.GetSettingBool("dns_enable", true),
		"dns_mode":            s.st.GetSetting("dns_mode", "fake-ip"),
		"dns_nameserver":      ns,
		"dns_fallback":        fb,
		"geo_enabled":         s.st.GetSettingBool("geo_enabled", true),
		"geo_auto_update":     s.st.GetSettingBool("geo_auto_update", true),
		"geo_update_interval": s.st.GetSettingInt("geo_update_interval", 24),
		"geox_urls":           geox,
		"default_geox_urls":   service.DefaultGeoxSources(),
		"core_mirror":         s.st.GetSetting("core_mirror", ""),
	})
}

func boolStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func (s *Server) handleGetPendingConfigChanges(w http.ResponseWriter, r *http.Request) {
	items, err := s.st.ListPendingConfigChanges()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取待应用配置失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"count": len(items), "items": items})
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	// 与统一应用共享锁，确保本次保存要么完整进入待应用清单，要么被本次
	// 一键应用捕获，不会在快照提交后被错误清空。
	s.configApplyMu.Lock()
	defer s.configApplyMu.Unlock()

	var p settingsPayload
	if err := readJSON(r, &p); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	// 不能先保存再等待用户应用：TUN 设备虽然可创建、但 auto-redirect 后端
	// 不可用时，mihomo 会以“内核运行、透明代理不生效”的状态启动。拒绝该
	// 写入可避免把一个必然失败的 TUN 配置放进待应用列表。
	if p.TunEnable != nil && *p.TunEnable {
		check := runTunEnvironmentCheck()
		if !check.CanEnable {
			writeErr(w, http.StatusBadRequest, "TUN 无法启用："+check.BlockingReason())
			return
		}
	}
	if p.MixedPort != nil {
		if *p.MixedPort < 1 || *p.MixedPort > 65535 {
			writeErr(w, http.StatusBadRequest, "端口无效")
			return
		}
	}
	if p.GeoUpdateInterval != nil {
		if *p.GeoUpdateInterval < 1 || *p.GeoUpdateInterval > 720 {
			writeErr(w, http.StatusBadRequest, "Geo 更新间隔需在 1 到 720 小时之间")
			return
		}
	}
	var geoxURLs map[string][]string
	if p.GeoxUrls != nil {
		var err error
		geoxURLs, err = validateGeoxURLs(p.GeoxUrls)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	configValues := map[string]string{}
	if p.MixedPort != nil {
		configValues["mixed_port"] = strconv.Itoa(*p.MixedPort)
	}
	if p.AllowLan != nil {
		configValues["allow_lan"] = boolStr(*p.AllowLan)
	}
	if p.LogLevel != nil {
		configValues["log_level"] = *p.LogLevel
	}
	if p.TunEnable != nil {
		configValues["tun_enable"] = boolStr(*p.TunEnable)
	}
	if p.TunStack != nil {
		configValues["tun_stack"] = *p.TunStack
	}
	if p.DnsEnable != nil {
		configValues["dns_enable"] = boolStr(*p.DnsEnable)
	}
	if p.DnsMode != nil {
		configValues["dns_mode"] = *p.DnsMode
	}
	if p.DnsNameserver != nil {
		b, _ := json.Marshal(p.DnsNameserver)
		configValues["dns_nameserver"] = string(b)
	}
	if p.DnsFallback != nil {
		b, _ := json.Marshal(p.DnsFallback)
		configValues["dns_fallback"] = string(b)
	}
	if p.GeoEnabled != nil {
		configValues["geo_enabled"] = boolStr(*p.GeoEnabled)
	}
	if p.GeoAutoUpdate != nil {
		configValues["geo_auto_update"] = boolStr(*p.GeoAutoUpdate)
	}
	if p.GeoUpdateInterval != nil {
		configValues["geo_update_interval"] = strconv.Itoa(*p.GeoUpdateInterval)
	}
	if geoxURLs != nil {
		b, _ := json.Marshal(geoxURLs)
		configValues["geox_urls"] = string(b)
	}

	pending, err := s.st.UpdateConfigSettingsAndSyncPending(configValues)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "保存配置失败: "+err.Error())
		return
	}
	set := func(k, v string) error { return s.st.SetSetting(k, v) }
	if p.CoreMirror != nil {
		if err := set("core_mirror", strings.TrimSpace(*p.CoreMirror)); err != nil {
			writeErr(w, http.StatusInternalServerError, "保存设置失败: "+err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":            true,
		"pending_count": len(pending),
		"pending": map[string]any{
			"count": len(pending),
			"items": pending,
		},
	})
}

var supportedGeoxURLKeys = map[string]bool{
	"geoip": true, "geoip.metadb": true, "geosite": true, "mmdb": true, "asn": true,
}

func validateGeoxURLs(values map[string][]string) (map[string][]string, error) {
	cleaned := make(map[string][]string, len(values))
	for key, urls := range values {
		if !supportedGeoxURLKeys[key] {
			return nil, fmt.Errorf("不支持的 Geo 数据类型：%s", key)
		}
		for _, raw := range urls {
			raw = strings.TrimSpace(raw)
			if raw == "" {
				continue
			}
			parsed, err := url.ParseRequestURI(raw)
			if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
				return nil, fmt.Errorf("%s 数据源 URL 无效：%s", key, raw)
			}
			cleaned[key] = append(cleaned[key], raw)
		}
	}
	return cleaned, nil
}

// ---------- 备份 ----------

func (s *Server) handleBackupExport(w http.ResponseWriter, r *http.Request) {
	data, err := s.st.ExportAll()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=easyproxy-backup.json")
	_ = json.NewEncoder(w).Encode(data)
}

func (s *Server) handleBackupRestore(w http.ResponseWriter, r *http.Request) {
	s.configApplyMu.Lock()
	defer s.configApplyMu.Unlock()

	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "上传失败")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "缺少文件字段 file")
		return
	}
	defer file.Close()
	body, _ := io.ReadAll(io.LimitReader(file, 64<<20))
	var data map[string]any
	if err := json.Unmarshal(body, &data); err != nil {
		writeErr(w, http.StatusBadRequest, "备份文件格式错误")
		return
	}
	if err := s.st.ImportAll(data, true); err != nil {
		writeErr(w, http.StatusInternalServerError, "恢复失败: "+err.Error())
		return
	}
	// 备份恢复属于显式的全量恢复操作，随后立即重启内核，因此将恢复后的
	// 设置和完整 YAML 作为新的已应用快照，并清除旧环境遗留的待应用/重试记录。
	settings, err := s.st.CurrentConfigSettings()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取恢复配置失败: "+err.Error())
		return
	}
	yaml, err := s.generateConfigForSettings(settings)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "生成恢复配置失败: "+err.Error())
		return
	}
	if err := s.st.CommitAppliedConfig(settings, yaml); err != nil {
		writeErr(w, http.StatusInternalServerError, "保存已应用配置快照失败: "+err.Error())
		return
	}
	changes, err := s.st.ListPendingConfigChanges()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取待应用配置失败: "+err.Error())
		return
	}
	scopes := make([]string, 0, len(changes))
	for _, change := range changes {
		scopes = append(scopes, change.Scope)
	}
	if err := s.st.DeletePendingConfigChanges(scopes...); err != nil {
		writeErr(w, http.StatusInternalServerError, "清理待应用配置失败: "+err.Error())
		return
	}
	s.mustChangePw.Store(s.st.GetSettingBool("must_change_password", false))
	_ = s.writeConfigYAML(yaml)
	_ = s.mgr.Restart()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "已恢复，内核已重启加载新配置"})
}
