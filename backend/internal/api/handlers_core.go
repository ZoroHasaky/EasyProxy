package api

import (
	"encoding/json"
	"io"
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
			"installed": s.coreInstalled(),
			"version":   core.InstalledCoreVersion(s.dataDir),
			"state":     st.State,
			"pid":       st.PID,
			"restarts":  st.Restarts,
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
		"installed":       s.coreInstalled(),
		"installed_version": core.InstalledCoreVersion(s.dataDir),
		"state":           st.State,
		"pid":             st.PID,
		"restarts":        st.Restarts,
		"last_error":      st.LastError,
		"downloading":     dlRunning,
		"download_error":  dlErr,
		"latest_version":  latest,
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
		if err := core.DownloadCore(s.dataDir, ver, mirror); err != nil {
			s.dlMu.Lock()
			s.dlErr = err.Error()
			s.dlMu.Unlock()
			return
		}
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

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, update.Check(s.updateRepo(), s.version))
}

func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	repo := s.updateRepo()
	rel, err := update.Apply(repo, s.version, s.dataDir)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "version": strings.TrimPrefix(rel.TagName, "v"), "message": "新版本已就绪，即将重启切换",
	})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	go func() {
		time.Sleep(1 * time.Second)
		_ = s.mgr.Stop()
		update.ExecNewest(s.dataDir, s.version)
	}()
}

// ---------- 设置 ----------

type settingsPayload struct {
	MixedPort     *int     `json:"mixed_port"`
	AllowLan      *bool    `json:"allow_lan"`
	LogLevel      *string  `json:"log_level"`
	TunEnable     *bool    `json:"tun_enable"`
	TunStack      *string  `json:"tun_stack"`
	DnsEnable     *bool    `json:"dns_enable"`
	DnsMode       *string  `json:"dns_mode"`
	DnsNameserver []string `json:"dns_nameserver"`
	DnsFallback   []string `json:"dns_fallback"`
	GeoxUrls      map[string]string `json:"geox_urls"`
	UpdateRepo    *string  `json:"update_repo"`
	CoreMirror    *string  `json:"core_mirror"`
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
	geox := map[string]string{}
	if !s.st.GetSettingJSON("geox_urls", &geox) || len(geox) == 0 {
		geox = service.DefaultGeoxURLs()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mixed_port":     s.st.GetSettingInt("mixed_port", 7890),
		"allow_lan":      s.st.GetSettingBool("allow_lan", true),
		"log_level":      s.st.GetSetting("log_level", "info"),
		"tun_enable":     s.st.GetSettingBool("tun_enable", false),
		"tun_stack":      s.st.GetSetting("tun_stack", "mixed"),
		"dns_enable":     s.st.GetSettingBool("dns_enable", true),
		"dns_mode":       s.st.GetSetting("dns_mode", "fake-ip"),
		"dns_nameserver": ns,
		"dns_fallback":   fb,
		"geox_urls":      geox,
		"update_repo":    s.updateRepo(),
		"core_mirror":    s.st.GetSetting("core_mirror", ""),
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
	if p.GeoxUrls != nil {
		b, _ := json.Marshal(p.GeoxUrls)
		set("geox_urls", string(b))
	}
	if p.UpdateRepo != nil {
		set("update_repo", strings.TrimSpace(*p.UpdateRepo))
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
	s.dirty.Store(true)
	_ = s.writeGeneratedConfig()
	_ = s.mgr.Restart()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "已恢复，内核已重启加载新配置"})
}
