package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"easyproxy/internal/core"
	"easyproxy/internal/model"
	"easyproxy/internal/service"
)

// ---------- 模板 ----------

func (s *Server) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	tpls, err := s.st.ListTemplates()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tpls)
}

func (s *Server) fetchTemplateContent(urlStr, ua string) (string, error) {
	// 内核运行中提供代理地址：直连失败自动经代理重试（模板多在 GitHub，国内常需代理）
	proxy := ""
	if s.mgr.Status().State == core.StateRunning {
		proxy = fmt.Sprintf("127.0.0.1:%d", s.st.GetSettingInt("mixed_port", 7890))
	}
	content, _, err := service.FetchSubscriptionAuto(urlStr, ua, false, proxy)
	return content, err
}

func (s *Server) handleCreateTemplate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string `json:"name"`
		URL     string `json:"url"`
		Content string `json:"content"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if req.Name == "" {
		req.Name = "模板"
	}
	tpl := &model.Template{Name: req.Name, Source: "paste", Mapping: map[string]string{}}
	if req.URL != "" {
		content, err := s.fetchTemplateContent(req.URL, "")
		if err != nil {
			writeErr(w, http.StatusBadRequest, "模板下载失败: "+err.Error())
			return
		}
		tpl.Source, tpl.URL, tpl.Content = "url", req.URL, content
	} else if req.Content != "" {
		tpl.Content = req.Content
	} else {
		writeErr(w, http.StatusBadRequest, "请提供模板 URL 或内容")
		return
	}
	if _, err := service.ParseTemplateContent(tpl.Content); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.st.CreateTemplate(tpl); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := service.ApplyTemplateRules(s.st, tpl); err != nil {
		writeErr(w, http.StatusInternalServerError, "规则解析失败: "+err.Error())
		return
	}
	s.dirty.Store(true)
	fresh, _ := s.st.GetTemplate(tpl.ID)
	writeJSON(w, http.StatusOK, fresh)
}

func (s *Server) handleRefreshTemplate(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	tpl, err := s.st.GetTemplate(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "模板不存在")
		return
	}
	if tpl.URL == "" {
		writeErr(w, http.StatusBadRequest, "该模板不是 URL 来源，无法刷新")
		return
	}
	content, err := s.fetchTemplateContent(tpl.URL, "")
	if err != nil {
		writeErr(w, http.StatusBadGateway, "模板下载失败: "+err.Error())
		return
	}
	tpl.Content = content
	if err := service.ApplyTemplateRules(s.st, tpl); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.dirty.Store(true)
	fresh, _ := s.st.GetTemplate(tpl.ID)
	writeJSON(w, http.StatusOK, fresh)
}

func (s *Server) handleTemplateMapping(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	tpl, err := s.st.GetTemplate(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "模板不存在")
		return
	}
	var req struct {
		Mapping map[string]string `json:"mapping"`
	}
	if err := readJSON(r, &req); err != nil || req.Mapping == nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	tpl.Mapping = req.Mapping
	if err := service.ApplyTemplateRules(s.st, tpl); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.dirty.Store(true)
	fresh, _ := s.st.GetTemplate(tpl.ID)
	writeJSON(w, http.StatusOK, fresh)
}

func (s *Server) handleActivateTemplate(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.st.ActivateTemplate(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.st.DeleteTemplate(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------- 规则 ----------

func (s *Server) handleGetRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.st.ListCurrentRules()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	providers, err := s.st.ListCurrentRuleProviders()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if rules == nil {
		rules = []model.Rule{}
	}
	if providers == nil {
		providers = []model.RuleProvider{}
	}
	s.enrichRuleProviderStatus(providers)
	writeJSON(w, http.StatusOK, map[string]any{
		"rules": rules, "providers": providers,
	})
}

func (s *Server) handlePutRules(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Rules     []model.Rule         `json:"rules"`
		Providers []model.RuleProvider `json:"providers"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := s.st.ReplaceCurrentRules(req.Rules, req.Providers); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(req.Rules)})
}

func (s *Server) handlePreviewRuleTemplate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL     string `json:"url"`
		Content string `json:"content"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	content := strings.TrimSpace(req.Content)
	if strings.TrimSpace(req.URL) != "" {
		var err error
		content, err = s.fetchTemplateContent(strings.TrimSpace(req.URL), "")
		if err != nil {
			writeErr(w, http.StatusBadRequest, "模板下载失败: "+err.Error())
			return
		}
	}
	if content == "" {
		writeErr(w, http.StatusBadRequest, "请提供模板 URL 或内容")
		return
	}
	parsed, err := service.ParseTemplateContent(content)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	groups, err := s.st.ListGroups()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	mapping := map[string]string{}
	for _, target := range parsed.Targets {
		mapping[target] = service.SuggestMapping(target, groups)
	}
	for i := range parsed.Rules {
		parsed.Rules[i].ID = int64(i + 1)
		parsed.Rules[i].TemplateID = 0
		parsed.Rules[i].BaseTarget = parsed.Rules[i].Target
	}
	for i := range parsed.Providers {
		parsed.Providers[i].ID = 0
		parsed.Providers[i].TemplateID = 0
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"rules": parsed.Rules, "providers": parsed.Providers,
		"targets": parsed.Targets, "mapping": mapping,
	})
}

func (s *Server) enrichRuleProviderStatus(providers []model.RuleProvider) {
	state := s.mgr.Status().State
	if state != core.StateRunning {
		for i := range providers {
			providers[i].Status = "core_stopped"
		}
		return
	}
	runtimeProviders, err := s.client.GetRuleProviders()
	if err != nil {
		for i := range providers {
			providers[i].Status = "unknown"
		}
		return
	}
	applyRuleProviderRuntimeStatus(providers, runtimeProviders)
}

func applyRuleProviderRuntimeStatus(providers []model.RuleProvider, runtimeProviders map[string]core.RuleProviderRuntime) {
	for i := range providers {
		state, ok := runtimeProviders[providers[i].Name]
		if !ok {
			providers[i].Status = "not_loaded"
			continue
		}
		providers[i].RuleCount = state.RuleCount
		if state.UpdatedAt != "" || state.RuleCount > 0 {
			providers[i].Status = "downloaded"
		} else {
			providers[i].Status = "not_downloaded"
		}
	}
}

func (s *Server) handleRuleProviderStatuses(w http.ResponseWriter, r *http.Request) {
	providers, err := s.st.ListCurrentRuleProviders()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.enrichRuleProviderStatus(providers)
	writeJSON(w, http.StatusOK, providers)
}

func (s *Server) handleRuleProviderContent(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	provider, err := s.st.GetCurrentRuleProvider(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "识别规则不存在")
		return
	}
	providers := []model.RuleProvider{*provider}
	s.enrichRuleProviderStatus(providers)
	provider = &providers[0]
	if strings.EqualFold(provider.Format, "mrs") {
		writeJSON(w, http.StatusOK, map[string]any{
			"provider": provider, "expandable": false,
			"items": []string{}, "total": 0, "page": 1, "size": 0,
		})
		return
	}
	content, err := s.fetchTemplateContent(provider.URL, "")
	if err != nil {
		writeErr(w, http.StatusBadGateway, "识别规则下载失败: "+err.Error())
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	size, _ := strconv.Atoi(r.URL.Query().Get("size"))
	result, err := service.ParseRuleProviderContent(content, provider.Format, r.URL.Query().Get("q"), page, size)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"provider": provider, "expandable": true,
		"items": result.Items, "total": result.Total, "page": result.Page, "size": result.Size,
	})
}

func (s *Server) handleGetRuleTargets(w http.ResponseWriter, r *http.Request) {
	targets, err := service.ListRuleTargetOptions(s.st)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, targets)
}

// ---------- 策略组 ----------

func (s *Server) handleGetGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := s.st.ListGroups()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if groups == nil {
		groups = []model.Group{}
	}
	writeJSON(w, http.StatusOK, groups)
}

func validGroupType(t string) bool {
	switch t {
	case "select", "url-test", "fallback", "load-balance":
		return true
	}
	return false
}

func (s *Server) handlePutGroups(w http.ResponseWriter, r *http.Request) {
	var groups []model.Group
	if err := readJSON(r, &groups); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	seen := map[string]bool{}
	for _, g := range groups {
		if g.Name == "" || seen[g.Name] {
			writeErr(w, http.StatusBadRequest, "策略组名称为空或重复")
			return
		}
		seen[g.Name] = true
		if !validGroupType(g.Type) {
			g.Type = "select"
		}
	}
	if err := s.st.ReplaceGroups(groups); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(groups)})
}

func (s *Server) handleGenerateRegionGroups(w http.ResponseWriter, r *http.Request) {
	created, err := service.GenerateRegionGroups(s.st)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, map[string]any{"created": created})
}

// ---------- 配置生成 / 应用 ----------

func (s *Server) handleConfigPreview(w http.ResponseWriter, r *http.Request) {
	gen, err := service.GenerateConfig(s.st)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "配置生成失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, gen)
}

// applyConfig 生成并写入 config.yaml，然后热重载或重启内核
func tunConfigNeedsRestart(running map[string]any, desiredEnabled bool, desiredStack string) bool {
	tun, ok := running["tun"].(map[string]any)
	if !ok {
		return true
	}
	enabled, ok := tun["enable"].(bool)
	if !ok || enabled != desiredEnabled {
		return true
	}
	if !desiredEnabled {
		return false
	}
	stack, ok := tun["stack"].(string)
	return !ok || stack != desiredStack
}

func (s *Server) applyConfig() (string, error) {
	if !s.writeGeneratedConfig() {
		return "", fmt.Errorf("配置生成失败")
	}
	if _, err := os.Stat(core.CorePath(s.dataDir)); err != nil {
		return "saved", nil // 内核缺失，仅保存
	}
	st := s.mgr.Status()
	if st.State != core.StateRunning {
		if err := s.mgr.Start(); err != nil {
			return "", err
		}
		return "started", nil
	}
	needRestart := false
	var running map[string]any
	if err := s.client.GetConfigs(&running); err == nil {
		if tunConfigNeedsRestart(
			running,
			s.st.GetSettingBool("tun_enable", false),
			s.st.GetSetting("tun_stack", "mixed"),
		) {
			needRestart = true
		}
		if mp, ok := running["mixed-port"].(float64); ok && int(mp) != s.st.GetSettingInt("mixed_port", 7890) {
			needRestart = true
		}
	}
	if needRestart {
		if err := s.mgr.Restart(); err != nil {
			return "", err
		}
		return "restarted", nil
	}
	// 新版 mihomo 要求 PUT /configs 的 path 为绝对路径
	if err := s.client.ReloadConfig(filepath.Join(s.dataDir, "config.yaml")); err != nil {
		// 热重载失败时退回重启内核，保证配置仍能生效
		if rerr := s.mgr.Restart(); rerr != nil {
			return "", fmt.Errorf("热重载失败: %v；重启内核也失败: %v", err, rerr)
		}
		return "restarted", nil
	}
	return "reloaded", nil
}

func (s *Server) handleConfigApply(w http.ResponseWriter, r *http.Request) {
	result, err := s.applyConfig()
	if err != nil {
		writeErr(w, http.StatusBadGateway, "应用失败: "+err.Error())
		return
	}
	s.dirty.Store(false)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": result})
}
