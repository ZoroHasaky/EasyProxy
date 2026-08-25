package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"easyproxy/internal/model"
)

const auditLogLimit = 100

var auditURLPattern = regexp.MustCompile(`https?://[^\s"']+`)

type auditResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *auditResponseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *auditResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(data)
}

func (w *auditResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *auditResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (s *Server) audit(category, event, level, summary string, details map[string]any) {
	if _, err := s.st.CreateAuditLog(model.AuditLog{
		Category: category,
		Event:    event,
		Level:    level,
		Summary:  summary,
		Details:  details,
	}, ""); err != nil {
		log.Printf("[audit] 写入日志失败: %v", err)
	}
}

func (s *Server) auditOnce(category, event, level, summary, sourceKey string, details map[string]any) {
	if _, err := s.st.CreateAuditLog(model.AuditLog{
		Category: category,
		Event:    event,
		Level:    level,
		Summary:  summary,
		Details:  details,
	}, sourceKey); err != nil {
		log.Printf("[audit] 写入日志失败: %v", err)
	}
}

func truncateAuditText(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 300 {
		return value
	}
	return value[:300] + "…"
}

func safeAuditError(err error) string {
	if err == nil {
		return ""
	}
	return truncateAuditText(auditURLPattern.ReplaceAllString(err.Error(), "[地址已隐藏]"))
}

func auditRoute(pattern, method string) (category, event, summary string, ok bool) {
	switch pattern {
	case "/api/subscriptions":
		return "operation", "subscription.changed", "订阅配置已更新", true
	case "/api/subscriptions/{id}":
		return "operation", "subscription.changed", "订阅配置已更新", true
	case "/api/subscriptions/{id}/update":
		return "operation", "subscription.refresh", "订阅已刷新", true
	case "/api/nodes/import":
		return "operation", "node.import", "节点已导入", true
	case "/api/nodes/check":
		return "operation", "node.batch_delay", "节点批量测速已执行", true
	case "/api/nodes/prune":
		return "operation", "node.prune", "失效节点清理已执行", true
	case "/api/nodes/{id}/delay":
		return "operation", "node.delay", "节点测速已执行", true
	case "/api/nodes/{id}":
		return "operation", "node.changed", "节点配置已更新", true
	case "/api/recognition-rules":
		return "operation", "routing.recognition", "识别规则已更新", true
	case "/api/recognition-rules/import":
		return "operation", "routing.recognition_import", "YAML 识别规则已导入", true
	case "/api/outbound-rules":
		return "operation", "routing.outbound", "出站映射已更新", true
	case "/api/groups":
		return "operation", "routing.group", "节点组合已更新", true
	case "/api/groups/generate-regions":
		return "operation", "routing.region_groups", "地区节点组合已生成", true
	case "/api/config/apply":
		return "operation", "config.apply", "待应用配置已执行", true
	case "/api/settings":
		return "operation", "settings.changed", "系统设置已保存", true
	case "/api/password":
		return "operation", "security.password", "管理密码已修改", true
	case "/api/logout":
		return "operation", "security.logout", "管理员已退出登录", true
	case "/api/backup/restore":
		return "operation", "backup.restore", "备份恢复已执行", true
	}
	return "", "", "", false
}

func shouldAuditRoute(pattern, method string) bool {
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		return true
	}
	return pattern == "/api/nodes/{id}/delay" && method == http.MethodGet
}

func isExplicitlyAudited(pattern string) bool {
	switch pattern {
	case "/api/core/download", "/api/core/upload", "/api/core/restart", "/api/update/apply", "/api/update/restart", "/api/geo/refresh":
		return true
	}
	return false
}

func (s *Server) auditHandler(pattern string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !shouldAuditRoute(pattern, r.Method) || isExplicitlyAudited(pattern) {
			next(w, r)
			return
		}
		capture := &auditResponseWriter{ResponseWriter: w}
		next(capture, r)
		category, event, summary, ok := auditRoute(pattern, r.Method)
		if !ok {
			category, event, summary = "operation", "panel.mutation", "面板操作已执行"
		}
		status := capture.status
		if status == 0 {
			status = http.StatusOK
		}
		level := "success"
		if status >= http.StatusBadRequest {
			level = "error"
			summary = strings.TrimSuffix(summary, "已执行") + "失败"
		}
		s.audit(category, event, level, summary, map[string]any{"http_status": status})
	}
}

func (s *Server) auditMihomoProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		s.handleMihomoProxy(w, r)
		return
	}
	capture := &auditResponseWriter{ResponseWriter: w}
	s.handleMihomoProxy(capture, r)
	status := capture.status
	if status == 0 {
		status = http.StatusOK
	}
	summary := "内核运行配置已调整"
	if r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "/connections") {
		summary = "内核连接已断开"
	}
	level := "success"
	if status >= http.StatusBadRequest {
		level, summary = "error", summary+"失败"
	}
	s.audit("operation", "core.runtime", level, summary, map[string]any{"http_status": status})
}

func parseAuditLogFilter(r *http.Request) (model.AuditLogFilter, error) {
	query := r.URL.Query()
	filter := model.AuditLogFilter{
		Category: query.Get("category"),
		Level:    query.Get("level"),
		Query:    query.Get("q"),
		Limit:    auditLogLimit,
	}
	if limit := query.Get("limit"); limit != "" {
		value, err := strconv.Atoi(limit)
		if err != nil || value < 1 || value > 500 {
			return filter, fmt.Errorf("limit 必须在 1 到 500 之间")
		}
		filter.Limit = value
	}
	if before := query.Get("before"); before != "" {
		value, err := strconv.ParseInt(before, 10, 64)
		if err != nil || value < 1 {
			return filter, fmt.Errorf("before 参数无效")
		}
		filter.BeforeID = value
	}
	if filter.Category != "" && filter.Category != "all" && filter.Category != "traffic" && filter.Category != "operation" && filter.Category != "core" {
		return filter, fmt.Errorf("日志分类无效")
	}
	if filter.Level != "" && filter.Level != "all" && filter.Level != "info" && filter.Level != "success" && filter.Level != "warning" && filter.Level != "error" {
		return filter, fmt.Errorf("日志级别无效")
	}
	return filter, nil
}

func (s *Server) handleListAuditLogs(w http.ResponseWriter, r *http.Request) {
	filter, err := parseAuditLogFilter(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	items, nextBefore, err := s.st.ListAuditLogs(filter)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取日志失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_before": nextBefore})
}

func (s *Server) handleExportAuditLogs(w http.ResponseWriter, r *http.Request) {
	filter, err := parseAuditLogFilter(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="easyproxy-logs.txt"`)
	if err := s.st.VisitAuditLogs(filter, func(entry model.AuditLog) error {
		if _, err := fmt.Fprintf(w, "[%s] [%s] [%s] %s\n", entry.CreatedAt.Format(time.RFC3339), strings.ToUpper(entry.Category), strings.ToUpper(entry.Level), entry.Summary); err != nil {
			return err
		}
		if len(entry.Details) == 0 {
			return nil
		}
		details, err := json.Marshal(entry.Details)
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(w, "  详情: %s\n", details)
		return err
	}); err != nil {
		log.Printf("[audit] 导出日志失败: %v", err)
	}
}
