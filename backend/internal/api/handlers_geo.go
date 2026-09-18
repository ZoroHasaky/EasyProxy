package api

import (
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"

	"easyproxy/internal/model"
)

type createGeoRecognitionRuleRequest struct {
	Kind      string `json:"kind"`
	Condition string `json:"condition"`
	Name      string `json:"name"`
	Priority  *int   `json:"priority"`
	Enabled   *bool  `json:"enabled"`
}

func (s *Server) handleGeoDataCategories(w http.ResponseWriter, r *http.Request) {
	key := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("key")))
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	result, err := s.geoBrowser.ListCategories(key, query)
	if err != nil {
		writeErr(w, geoBrowseErrorStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleGeoDataEntries(w http.ResponseWriter, r *http.Request) {
	key := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("key")))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	page, pageSize, err := parseGeoBrowsePaging(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if category == "" {
		writeErr(w, http.StatusBadRequest, "Geo 分类不能为空")
		return
	}
	result, err := s.geoBrowser.ListEntries(key, category, query, page, pageSize)
	if err != nil {
		writeErr(w, geoBrowseErrorStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func parseGeoBrowsePaging(r *http.Request) (int, int, error) {
	page, pageSize := 1, 100
	if raw := strings.TrimSpace(r.URL.Query().Get("page")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 {
			return 0, 0, errors.New("page 必须是大于等于 1 的整数")
		}
		page = value
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("page_size")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			return 0, 0, errors.New("page_size 必须在 1 到 200 之间")
		}
		pageSize = value
	}
	return page, pageSize, nil
}

func geoBrowseErrorStatus(err error) int {
	if errors.Is(err, os.ErrNotExist) {
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func (s *Server) handleCreateGeoRecognitionRule(w http.ResponseWriter, r *http.Request) {
	var req createGeoRecognitionRuleRequest
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	kind := strings.ToUpper(strings.TrimSpace(req.Kind))
	key, ok := geoDataKeyForRecognitionKind(kind)
	if !ok {
		writeErr(w, http.StatusBadRequest, "Geo 识别规则类型必须是 GEOIP 或 GEOSITE")
		return
	}
	condition := strings.TrimSpace(req.Condition)
	if condition == "" {
		writeErr(w, http.StatusBadRequest, "Geo 分类不能为空")
		return
	}

	// 只允许从当前本地数据中真实存在的分类创建规则，避免保存一个
	// Mihomo 会静默忽略的拼写错误分类。
	entries, err := s.geoBrowser.ListEntries(key, condition, "", 1, 1)
	if err != nil {
		writeErr(w, geoBrowseErrorStatus(err), err.Error())
		return
	}
	condition = entries.Category

	existing, err := s.st.ListRecognitionRules()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取现有识别规则失败: "+err.Error())
		return
	}
	for _, rule := range existing {
		if !strings.EqualFold(strings.TrimSpace(rule.Kind), kind) {
			continue
		}
		for _, existingCondition := range rule.Conditions {
			if strings.EqualFold(strings.TrimSpace(existingCondition), condition) {
				writeJSON(w, http.StatusOK, map[string]any{
					"ok":            true,
					"created":       false,
					"rule":          rule,
					"needs_mapping": true,
					"apply_result":  "",
					"apply_error":   "",
				})
				return
			}
		}
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "Geo · " + condition
	}
	for _, rule := range existing {
		if rule.Name == name {
			writeErr(w, http.StatusConflict, "识别规则名称已存在："+name)
			return
		}
	}
	priority := 1
	if req.Priority != nil {
		priority = *req.Priority
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	created, err := s.st.CreateRecognitionRules([]model.RecognitionRule{{
		Name:       name,
		Kind:       kind,
		Conditions: []string{condition},
		Priority:   priority,
		Enabled:    enabled,
	}})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	result, applyError := s.applyChangedConfig("recognition_rules", []string{"识别规则"})
	level, summary := "success", "已根据 Geo 数据创建识别规则"
	if applyError != "" {
		level, summary = "warning", "已创建 Geo 识别规则，但自动应用失败"
	}
	s.audit("operation", "routing.geo_create", level, summary, map[string]any{
		"kind": kind, "condition": condition, "name": name,
		"apply_result": result, "apply_error": safeAuditErrorString(applyError),
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":            true,
		"created":       true,
		"rule":          created[0],
		"needs_mapping": true,
		"apply_result":  result,
		"apply_error":   applyError,
	})
}

func geoDataKeyForRecognitionKind(kind string) (string, bool) {
	switch kind {
	case "GEOIP":
		return "geoip", true
	case "GEOSITE":
		return "geosite", true
	default:
		return "", false
	}
}

func safeAuditErrorString(value string) string {
	if value == "" {
		return ""
	}
	return safeAuditError(errors.New(value))
}
