package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"easyproxy/internal/core"
	"easyproxy/internal/service"
	"easyproxy/internal/store"
	"easyproxy/internal/web"
)

type Server struct {
	st       *store.Store
	dataDir  string
	version  string
	mgr      *core.Manager
	client   *core.Client
	sessions *SessionManager

	mihomoRP *httputil.ReverseProxy

	configApplyMu sync.Mutex

	// must_changePw 内存缓存：鉴权是所有请求的热路径，不依赖数据库连接
	mustChangePw atomic.Bool

	dlMu          sync.Mutex
	dlRunning     bool
	dlErr         string
	latestCache   string
	latestCacheAt time.Time

	updateMu   sync.Mutex
	updateTask updateTaskStatus
}

type updateTaskStatus struct {
	State     string `json:"state"`
	Running   bool   `json:"running"`
	Completed int64  `json:"completed"`
	Total     int64  `json:"total"`
	Percent   int    `json:"percent"`
	Version   string `json:"version"`
	Error     string `json:"error,omitempty"`
	ViaProxy  bool   `json:"via_proxy"`
}

func New(st *store.Store, dataDir, version string) *Server {
	secret := st.GetSetting("controller_secret", "")
	if secret == "" {
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		secret = hex.EncodeToString(b)
		_ = st.SetSetting("controller_secret", secret)
	}
	port := st.GetSettingInt("controller_port", 9095)
	s := &Server{
		st:         st,
		dataDir:    dataDir,
		version:    version,
		mgr:        core.NewManager(core.CorePath(dataDir), dataDir),
		client:     core.NewClient(port, secret),
		sessions:   NewSessionManager(),
		updateTask: updateTaskStatus{State: "idle"},
	}
	s.mustChangePw.Store(st.GetSettingBool("must_change_password", false))
	u, _ := url.Parse(s.client.BaseURL())
	s.mihomoRP = httputil.NewSingleHostReverseProxy(u)
	orig := s.mihomoRP.Director
	s.mihomoRP.Director = func(r *http.Request) {
		orig(r)
		r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api/mihomo")
		if r.URL.Path == "" {
			r.URL.Path = "/"
		}
		r.URL.RawPath = ""
		r.Header.Set("Authorization", "Bearer "+secret)
	}
	s.mihomoRP.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "内核未运行或不可达: " + err.Error()})
	}
	return s
}

// EnsureCoreStarted 生成配置并拉起内核；内核缺失时后台自动下载（仅 Linux 生产环境）
func (s *Server) EnsureCoreStarted() {
	s.writeGeneratedConfig()
	if _, err := os.Stat(core.CorePath(s.dataDir)); err == nil {
		if err := s.mgr.Start(); err != nil {
			log.Printf("[core] 启动失败: %v", err)
			s.audit("core", "core.start", "error", "Mihomo 内核启动失败", map[string]any{"error": safeAuditError(err)})
		} else {
			s.audit("core", "core.start", "success", "Mihomo 内核已启动", nil)
			s.refreshRecognitionRuleProvidersAfterCoreStart()
		}
		return
	}
	if runtime.GOOS != "linux" {
		log.Println("[core] 非 Linux 开发环境且内核不存在，跳过自动下载（生产环境为 Docker/Linux）")
		return
	}
	go func() {
		mirror := s.st.GetSetting("core_mirror", "")
		log.Println("[core] 内核不存在，开始自动下载…")
		s.audit("core", "core.auto_download", "info", "已开始自动下载 Mihomo 内核", nil)
		if err := core.DownloadCore(s.dataDir, "latest", mirror); err != nil {
			log.Printf("[core] 自动下载失败: %v（可在面板手动上传）", err)
			s.audit("core", "core.auto_download", "error", "Mihomo 内核自动下载失败", map[string]any{"error": safeAuditError(err)})
			return
		}
		log.Println("[core] 内核下载完成")
		s.writeGeneratedConfig()
		if err := s.mgr.Start(); err != nil {
			log.Printf("[core] 启动失败: %v", err)
			s.audit("core", "core.auto_download", "error", "Mihomo 内核自动下载完成，但启动失败", map[string]any{"error": safeAuditError(err)})
			return
		}
		s.audit("core", "core.auto_download", "success", "Mihomo 内核自动下载并启动完成", nil)
		s.refreshRecognitionRuleProvidersAfterCoreStart()
	}()
}

func (s *Server) writeGeneratedConfig() bool {
	if yaml, err := s.st.AppliedConfigYAML(); err != nil {
		log.Printf("[config] 读取已应用配置快照失败: %v", err)
		return false
	} else if yaml != "" {
		return s.writeConfigYAML(yaml)
	}
	// 兼容旧安装：首次迁移尚无完整 YAML 快照时，按已应用设置生成一份配置。
	gen, err := service.GenerateAppliedConfig(s.st)
	if err != nil {
		log.Printf("[config] 生成已应用配置失败: %v", err)
		return false
	}
	if err := s.st.SaveAppliedConfigYAML(gen.YAML); err != nil {
		log.Printf("[config] 初始化已应用配置快照失败: %v", err)
		return false
	}
	return s.writeConfigYAML(gen.YAML)
}

func (s *Server) generateConfigForSettings(values map[string]string) (string, error) {
	gen, err := service.GenerateConfigForSettings(s.st, values)
	if err != nil {
		return "", err
	}
	return gen.YAML, nil
}

func (s *Server) writeConfigYAML(yaml string) bool {
	if err := os.WriteFile(filepath.Join(s.dataDir, "config.yaml"), []byte(yaml), 0o644); err != nil {
		log.Printf("[config] 写入失败: %v", err)
		return false
	}
	return true
}

// Run 启动 HTTP 服务，收到退出信号时停内核
func (s *Server) Run(addr string) error {
	srv := &http.Server{Addr: addr, Handler: s.Handler()}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.audit("operation", "panel.started", "info", "EasyProxy 面板已启动", map[string]any{"version": s.version})
	s.startAuditWatchers(ctx)
	go s.subscriptionLoop(ctx)

	done := make(chan struct{})
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		cancel()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
		_ = s.mgr.Stop()
		close(done)
	}()

	err := srv.ListenAndServe()
	if err == http.ErrServerClosed {
		<-done
		return nil
	}
	return err
}

// subscriptionLoop 订阅定时更新
func (s *Server) subscriptionLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		// 连接池饱和告警：帮助发现连接异常不归还类问题
		if st := s.st.Stats(); st.MaxOpenConnections > 0 && st.InUse >= st.MaxOpenConnections && st.WaitCount > 0 {
			log.Printf("[db] 连接池饱和: in_use=%d max=%d waits=%d wait_ms=%d",
				st.InUse, st.MaxOpenConnections, st.WaitCount, st.WaitDuration.Milliseconds())
		}
		subs, err := s.st.ListSubscriptions()
		if err != nil {
			continue
		}
		for _, sub := range subs {
			if !sub.Enabled || sub.UpdateInterval <= 0 {
				continue
			}
			due := sub.LastUpdate.IsZero() ||
				time.Since(sub.LastUpdate) > time.Duration(sub.UpdateInterval)*time.Minute
			if !due {
				continue
			}
			proxy := s.runningCoreProxyAddr()
			added, removed, err := service.SyncSubscription(s.st, &sub, proxy)
			if err != nil {
				log.Printf("[sub] %s 定时更新失败: %v", sub.Name, err)
				s.audit("operation", "subscription.scheduled_refresh", "error", "订阅定时刷新失败", map[string]any{"subscription": sub.Name, "error": safeAuditError(err)})
				continue
			}
			result, applyError := s.applyChangedConfig("subscriptions", []string{"订阅"})
			if applyError != "" {
				log.Printf("[sub] %s 定时更新完成，但自动应用失败，已加入待重试: %s", sub.Name, applyError)
				s.audit("operation", "subscription.scheduled_refresh", "warning", "订阅定时刷新完成，但应用失败", map[string]any{"subscription": sub.Name, "added": added, "removed": removed})
				continue
			}
			log.Printf("[sub] %s 定时更新并%s完成", sub.Name, result)
			s.audit("operation", "subscription.scheduled_refresh", "success", "订阅定时刷新完成", map[string]any{"subscription": sub.Name, "added": added, "removed": removed, "apply_result": result})
		}
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// 公开
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("GET /api/meta", s.handleMeta)
	mux.HandleFunc("GET /api/regions", s.handleRegions)

	// 需登录
	route := func(pattern string, h http.HandlerFunc) {
		mux.Handle(pattern, s.auth(s.auditHandler(pattern, h)))
	}
	route("GET /api/me", s.handleMe)
	route("POST /api/logout", s.handleLogout)
	route("POST /api/password", s.handleChangePassword)

	route("GET /api/subscriptions", s.handleListSubs)
	route("POST /api/subscriptions", s.handleCreateSub)
	route("PUT /api/subscriptions/{id}", s.handleUpdateSub)
	route("DELETE /api/subscriptions/{id}", s.handleDeleteSub)
	route("POST /api/subscriptions/{id}/update", s.handleUpdateSubNow)

	route("GET /api/nodes", s.handleListNodes)
	route("POST /api/nodes/import", s.handleImportNodes)
	route("POST /api/nodes/check", s.handleCheckNodes)
	route("GET /api/nodes/{id}/delay", s.handleNodeDelay)
	route("GET /api/nodes/regions", s.handleNodeRegions)
	route("PATCH /api/nodes/{id}", s.handlePatchNode)
	route("DELETE /api/nodes/{id}", s.handleDeleteNode)

	route("GET /api/recognition-rules", s.handleGetRecognitionRules)
	route("PUT /api/recognition-rules", s.handlePutRecognitionRules)
	route("POST /api/recognition-rules/import", s.handleImportRecognitionRules)
	route("GET /api/recognition-rules/geo-presets", s.handleGetGeoRecognitionPresets)
	route("POST /api/recognition-rules/generate-geo", s.handleGenerateGeoRecognitionRules)
	route("GET /api/outbound-rules", s.handleGetOutboundRules)
	route("PUT /api/outbound-rules", s.handlePutOutboundRules)
	// 这是纯本地推演查询，不写操作日志，也不会访问用户填写的目标地址。
	mux.Handle("POST /api/outbound-rules/simulate", s.auth(http.HandlerFunc(s.handleSimulateOutbound)))
	route("GET /api/groups", s.handleGetGroups)
	route("PUT /api/groups", s.handlePutGroups)
	route("POST /api/groups/generate-regions", s.handleGenerateRegionGroups)

	route("GET /api/config/preview", s.handleConfigPreview)
	route("GET /api/config/pending", s.handleGetPendingConfigChanges)
	route("POST /api/config/apply", s.handleConfigApply)

	route("GET /api/core", s.handleCoreStatus)
	route("GET /api/core/logs", s.handleCoreLogs)
	route("POST /api/core/download", s.handleCoreDownload)
	route("POST /api/core/upload", s.handleCoreUpload)
	route("POST /api/core/restart", s.handleCoreRestart)
	route("GET /api/tun/check", s.handleTunCheck)

	route("GET /api/update/check", s.handleUpdateCheck)
	route("GET /api/update/status", s.handleUpdateStatus)
	route("POST /api/update/apply", s.handleUpdateApply)
	route("POST /api/update/restart", s.handleUpdateRestart)

	route("GET /api/settings", s.handleGetSettings)
	route("PUT /api/settings", s.handlePutSettings)
	route("GET /api/geo/status", s.handleGeoDataStatus)
	route("POST /api/geo/refresh", s.handleRefreshGeoData)
	route("GET /api/logs", s.handleListAuditLogs)
	route("GET /api/logs/export", s.handleExportAuditLogs)

	route("GET /api/backup", s.handleBackupExport)
	route("POST /api/backup/restore", s.handleBackupRestore)

	mux.Handle("/api/mihomo/", s.auth(http.HandlerFunc(s.auditMihomoProxy)))

	// websocket（内部做 cookie 鉴权）
	mux.HandleFunc("GET /api/ws/{stream}", s.handleWS)

	// 前端静态资源 + SPA 回退
	mux.HandleFunc("/", s.handleStatic)
	return mux
}

// ---------- 中间件 ----------

func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.sessions.Valid(r) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "未登录"})
			return
		}
		if s.mustChangePw.Load() {
			p := r.URL.Path
			if p != "/api/password" && p != "/api/me" && p != "/api/logout" && p != "/api/meta" {
				writeJSON(w, http.StatusForbidden, map[string]any{"error": "首次登录请先修改密码"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return fmt.Errorf("请求体为空")
	}
	return json.Unmarshal(body, v)
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeErr(w, http.StatusNotFound, "接口不存在")
		return
	}
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "前端资源缺失")
		return
	}
	p := strings.TrimPrefix(r.URL.Path, "/")
	if p == "" {
		p = "index.html"
	}
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		// 前端未构建（源码运行），给出占位提示
		data, _ := fs.ReadFile(dist, "placeholder.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(data)
		return
	}
	if _, err := fs.Stat(dist, p); err != nil {
		// SPA 回退
		r2 := new(http.Request)
		*r2 = *r
		r2.URL.Path = "/"
		http.FileServer(http.FS(dist)).ServeHTTP(w, r2)
		return
	}
	http.FileServer(http.FS(dist)).ServeHTTP(w, r)
}

func (s *Server) handleMihomoProxy(w http.ResponseWriter, r *http.Request) {
	s.mihomoRP.ServeHTTP(w, r)
}
