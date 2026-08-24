package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
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
		"core": map[string]any{
			"installed":  s.coreInstalled(),
			"version":    core.InstalledCoreVersion(s.dataDir),
			"state":      st.State,
			"pid":        st.PID,
			"restarts":   st.Restarts,
			"last_error": st.LastError,
		},
	})
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
		"restarts":          st.Restarts,
		"last_error":        st.LastError,
		"downloading":       dlRunning,
		"download_error":    dlErr,
		"latest_version":    latest,
	})
}

func (s *Server) handleCoreLogs(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.mgr.RecentLogs())
}

func (s *Server) handleCoreDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Version string `json:"version"`
	}
	_ = readJSON(r, &req)

	s.dlMu.Lock()
	if s.dlRunning {
		s.dlMu.Unlock()
		writeErr(w, http.StatusConflict, "已有下载任务进行中")
		return
	}
	s.dlRunning, s.dlErr = true, ""
	s.dlMu.Unlock()

	go func() {
		defer func() {
			s.dlMu.Lock()
			s.dlRunning = false
			s.dlMu.Unlock()
		}()
		mirror := s.st.GetSetting("core_mirror", "")
		ver := req.Version
		log.Printf("[core] 开始下载内核 ver=%s mirror=%s", ver, mirror)
		if err := core.DownloadCore(s.dataDir, ver, mirror); err != nil {
			s.dlMu.Lock()
			s.dlErr = err.Error()
			s.dlMu.Unlock()
			log.Printf("[core] 内核下载失败: %v", err)
			return
		}
		log.Printf("[core] 内核下载完成，重启内核")
		s.writeGeneratedConfig()
		_ = s.mgr.Restart()
	}()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "下载任务已开始"})
}

func (s *Server) handleCoreUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(200 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "上传失败: "+err.Error())
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "缺少文件字段 file")
		return
	}
	defer file.Close()
	if err := core.InstallCoreFromUpload(s.dataDir, hdr.Filename, file); err != nil {
		writeErr(w, http.StatusBadRequest, "安装失败: "+err.Error())
		return
	}
	s.writeGeneratedConfig()
	_ = s.mgr.Restart()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleCoreRestart(w http.ResponseWriter, r *http.Request) {
	if !s.coreInstalled() {
		writeErr(w, http.StatusBadRequest, "内核未安装")
		return
	}
	s.writeGeneratedConfig()
	if err := s.mgr.Restart(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleTunCheck 开启 TUN 前的权限预检（/dev/net/tun + NET_ADMIN）
func (s *Server) handleTunCheck(w http.ResponseWriter, r *http.Request) {
	ok, detail := core.CheckTunAvailable()
	writeJSON(w, http.StatusOK, map[string]any{"ok": ok, "detail": detail})
}

// ---------- 面板自更新 ----------

// DefaultUpdateRepo 内置更新源：本项目官方仓库
const DefaultUpdateRepo = "ZoroHasaky/EasyProxy"

// updateRepo 返回生效的更新源仓库；用户配置为空时回退官方源
func (s *Server) updateRepo() string {
	if repo := strings.TrimSpace(s.st.GetSetting("update_repo", "")); repo != "" {
		return repo
	}
	return DefaultUpdateRepo
}

func (s *Server) updateProxyAddr() (string, error) {
	if !s.st.GetSettingBool("update_via_proxy", false) {
		return "", nil
	}
	if s.mgr.Status().State != core.StateRunning {
		return "", fmt.Errorf("已启用经代理更新，但 mihomo 内核未运行")
	}
	return fmt.Sprintf("127.0.0.1:%d", s.st.GetSettingInt("mixed_port", 7890)), nil
}

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	proxy, err := s.updateProxyAddr()
	if err != nil {
		writeJSON(w, http.StatusOK, &update.CheckResult{Current: s.version, Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, update.Check(s.updateRepo(), s.version, proxy))
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
	proxy, err := s.updateProxyAddr()
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.updateMu.Lock()
	if s.updateTask.Running {
		s.updateMu.Unlock()
		writeErr(w, http.StatusConflict, "更新任务正在进行中")
		return
	}
	s.updateTask = updateTaskStatus{State: "checking", Running: true, ViaProxy: proxy != ""}
	s.updateMu.Unlock()

	repo := s.updateRepo()
	go func() {
		rel, err := update.Apply(repo, s.version, s.dataDir, proxy, s.setUpdateProgress)
		if err != nil {
			s.updateMu.Lock()
			s.updateTask.State = "error"
			s.updateTask.Running = false
			s.updateTask.Error = err.Error()
			s.updateMu.Unlock()
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
	}()
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "message": "更新任务已在后台启动"})
}

func (s *Server) handleUpdateRestart(w http.ResponseWriter, r *http.Request) {
	s.updateMu.Lock()
	if s.updateTask.State != "ready" || s.updateTask.Version == "" {
		s.updateMu.Unlock()
		writeErr(w, http.StatusConflict, "尚无已下载完成的更新")
		return
	}
	s.updateTask.State = "restarting"
	s.updateTask.Running = true
	s.updateTask.Error = ""
	s.updateMu.Unlock()

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
	UpdateRepo        *string             `json:"update_repo"`
	UpdateViaProxy    *bool               `json:"update_via_proxy"`
	CoreMirror        *string             `json:"core_mirror"`
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
		"geo_auto_update":     s.st.GetSettingBool("geo_auto_update", false),
		"geo_update_interval": s.st.GetSettingInt("geo_update_interval", 24),
		"geox_urls":           geox,
		"update_repo":         s.updateRepo(),
		"update_via_proxy":    s.st.GetSettingBool("update_via_proxy", false),
		"core_mirror":         s.st.GetSetting("core_mirror", ""),
	})
}

func boolStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var p settingsPayload
	if err := readJSON(r, &p); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	set := func(k, v string) { _ = s.st.SetSetting(k, v) }
	if p.MixedPort != nil {
		if *p.MixedPort < 1 || *p.MixedPort > 65535 {
			writeErr(w, http.StatusBadRequest, "端口无效")
			return
		}
		set("mixed_port", strconv.Itoa(*p.MixedPort))
	}
	if p.AllowLan != nil {
		set("allow_lan", boolStr(*p.AllowLan))
	}
	if p.LogLevel != nil {
		set("log_level", *p.LogLevel)
	}
	if p.TunEnable != nil {
		set("tun_enable", boolStr(*p.TunEnable))
	}
	if p.TunStack != nil {
		set("tun_stack", *p.TunStack)
	}
	if p.DnsEnable != nil {
		set("dns_enable", boolStr(*p.DnsEnable))
	}
	if p.DnsMode != nil {
		set("dns_mode", *p.DnsMode)
	}
	if p.DnsNameserver != nil {
		b, _ := json.Marshal(p.DnsNameserver)
		set("dns_nameserver", string(b))
	}
	if p.DnsFallback != nil {
		b, _ := json.Marshal(p.DnsFallback)
		set("dns_fallback", string(b))
	}
	if p.GeoEnabled != nil {
		set("geo_enabled", boolStr(*p.GeoEnabled))
	}
	if p.GeoAutoUpdate != nil {
		set("geo_auto_update", boolStr(*p.GeoAutoUpdate))
	}
	if p.GeoUpdateInterval != nil {
		if *p.GeoUpdateInterval < 1 || *p.GeoUpdateInterval > 720 {
			writeErr(w, http.StatusBadRequest, "Geo 更新间隔需在 1 到 720 小时之间")
			return
		}
		set("geo_update_interval", strconv.Itoa(*p.GeoUpdateInterval))
	}
	if p.GeoxUrls != nil {
		b, _ := json.Marshal(p.GeoxUrls)
		set("geox_urls", string(b))
	}
	if p.UpdateRepo != nil {
		set("update_repo", strings.TrimSpace(*p.UpdateRepo))
	}
	if p.UpdateViaProxy != nil {
		set("update_via_proxy", boolStr(*p.UpdateViaProxy))
	}
	if p.CoreMirror != nil {
		set("core_mirror", strings.TrimSpace(*p.CoreMirror))
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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
	s.mustChangePw.Store(s.st.GetSettingBool("must_change_password", false))
	s.dirty.Store(true)
	_ = s.writeGeneratedConfig()
	_ = s.mgr.Restart()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "已恢复，内核已重启加载新配置"})
}
