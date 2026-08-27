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
	"easyproxy/internal/store"
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
	proxy := s.runningCoreProxyAddr()
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
	fresh, _ := s.st.GetTemplate(tpl.ID)
	writeJSON(w, http.StatusOK, fresh)
}

func (s *Server) handleActivateTemplate(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.st.ActivateTemplate(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.st.DeleteTemplate(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
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

func validGroupMemberMode(mode string) bool {
	switch mode {
	case "", "all", "region", "manual", "regex":
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
		if !validGroupMemberMode(g.MemberMode) {
			writeErr(w, http.StatusBadRequest, "策略组节点范围无效")
			return
		}
		if g.MemberMode == "region" && g.Region == "" {
			writeErr(w, http.StatusBadRequest, "按地区筛选时必须选择地区")
			return
		}
		if g.MemberMode == "regex" && strings.TrimSpace(g.IncludeRegex) == "" {
			writeErr(w, http.StatusBadRequest, "按名称正则筛选时必须填写正则")
			return
		}
	}
	if err := s.st.ReplaceGroups(groups); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	result, applyError := s.applyChangedConfig("groups", []string{"节点组合"})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(groups), "apply_result": result, "apply_error": applyError})
}

func (s *Server) handleGenerateRegionGroups(w http.ResponseWriter, r *http.Request) {
	created, err := service.GenerateRegionGroups(s.st)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	result, applyError := s.applyChangedConfig("groups", []string{"节点组合"})
	writeJSON(w, http.StatusOK, map[string]any{"created": created, "apply_result": result, "apply_error": applyError})
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

func configValue(values map[string]string, key, def string) string {
	if value, ok := values[key]; ok {
		return value
	}
	return def
}

func configBool(values map[string]string, key string, def bool) bool {
	switch configValue(values, key, "") {
	case "1", "true":
		return true
	case "0", "false":
		return false
	default:
		return def
	}
}

func configInt(values map[string]string, key string, def int) int {
	value, err := strconv.Atoi(configValue(values, key, ""))
	if err != nil {
		return def
	}
	return value
}

// runningCoreProxyAddr 返回运行中的内核当前实际监听的混合端口。
// 端口改动在用户点击统一应用前不能用于订阅、更新等运行时请求。
func (s *Server) runningCoreProxyAddr() string {
	if s.mgr.Status().State != core.StateRunning {
		return ""
	}
	values, err := s.st.AppliedConfigSettings()
	if err != nil {
		return "127.0.0.1:7890"
	}
	return fmt.Sprintf("127.0.0.1:%d", configInt(values, "mixed_port", 7890))
}

// applyConfig 应用所有已保存的目标设置，仅由顶栏“一键应用”入口调用。
func (s *Server) applyConfig() (string, error) {
	s.configApplyMu.Lock()
	defer s.configApplyMu.Unlock()

	result, settings, yaml, err := s.applyConfigWithSettings(true)
	if err != nil {
		return "", err
	}
	if err := s.st.CommitAppliedConfig(settings, yaml); err != nil {
		return "", fmt.Errorf("更新已应用配置快照失败: %w", err)
	}
	if err := s.refreshActiveRecognitionRuleProviders(); err != nil {
		s.audit("core", "core.rule_provider_refresh", "error", "识别规则源刷新失败", map[string]any{"error": safeAuditError(err)})
		return "", err
	}
	changes, err := s.st.ListPendingConfigChanges()
	if err != nil {
		return "", fmt.Errorf("读取待应用配置失败: %w", err)
	}
	scopes := make([]string, 0, len(changes))
	for _, change := range changes {
		scopes = append(scopes, change.Scope)
	}
	if err := s.st.DeletePendingConfigChanges(scopes...); err != nil {
		return "", fmt.Errorf("清理待应用配置失败: %w", err)
	}
	return result, nil
}

// applyAppliedConfig 只应用最后一次成功应用的设置快照，用于节点/规则的即时生效。
func (s *Server) applyAppliedConfig(refreshRuleProviders bool) (string, error) {
	s.configApplyMu.Lock()
	defer s.configApplyMu.Unlock()

	result, _, yaml, err := s.applyConfigWithSettings(false)
	if err != nil {
		return "", err
	}
	if err := s.st.SaveAppliedConfigYAML(yaml); err != nil {
		return "", fmt.Errorf("保存已应用配置快照失败: %w", err)
	}
	if refreshRuleProviders {
		if err := s.refreshActiveRecognitionRuleProviders(); err != nil {
			s.audit("core", "core.rule_provider_refresh", "error", "识别规则源刷新失败", map[string]any{"error": safeAuditError(err)})
			return result, err
		}
	}
	return result, err
}

// applyConfigWithSettings 由已持有 configApplyMu 的调用方执行。它生成候选 YAML 并
// 加载到内核；调用方必须在锁内把成功的候选内容提交为已应用快照。
func (s *Server) applyConfigWithSettings(includePending bool) (string, map[string]string, string, error) {
	var values map[string]string
	if includePending {
		var err error
		values, err = s.st.CurrentConfigSettings()
		if err != nil {
			return "", nil, "", fmt.Errorf("读取目标配置失败: %w", err)
		}
	} else {
		var err error
		values, err = s.st.AppliedConfigSettings()
		if err != nil {
			return "", nil, "", fmt.Errorf("读取已应用配置失败: %w", err)
		}
	}
	yaml, err := s.generateConfigForSettings(values)
	if err != nil {
		return "", nil, "", fmt.Errorf("配置生成失败: %w", err)
	}
	if !s.writeConfigYAML(yaml) {
		return "", nil, "", fmt.Errorf("写入配置失败")
	}

	// 目标配置加载失败时立即回写此前成功的配置文件，避免下次手动重启
	// 意外带入尚未确认的设置或本次自动应用失败的数据。
	restoreAppliedConfig := func() {
		_ = s.writeGeneratedConfig()
	}
	if _, err := os.Stat(core.CorePath(s.dataDir)); err != nil {
		return "saved", values, yaml, nil // 内核缺失，仅保存
	}
	st := s.mgr.Status()
	verifyTun := func() {
		if configBool(values, "tun_enable", false) {
			s.verifyTunAfterStart()
		}
	}
	if st.State != core.StateRunning {
		if err := s.mgr.Start(); err != nil {
			restoreAppliedConfig()
			s.audit("core", "core.start", "error", "Mihomo 内核启动失败", map[string]any{"error": safeAuditError(err)})
			return "", values, "", err
		}
		s.audit("core", "core.start", "success", "Mihomo 内核已启动", nil)
		verifyTun()
		return "started", values, yaml, nil
	}
	needRestart := false
	var running map[string]any
	if err := s.client.GetConfigs(&running); err == nil {
		if tunConfigNeedsRestart(
			running,
			configBool(values, "tun_enable", false),
			configValue(values, "tun_stack", "mixed"),
		) {
			needRestart = true
		}
		if mp, ok := running["mixed-port"].(float64); ok && int(mp) != configInt(values, "mixed_port", 7890) {
			needRestart = true
		}
	}
	if needRestart {
		if err := s.mgr.Restart(); err != nil {
			restoreAppliedConfig()
			s.audit("core", "core.restart", "error", "Mihomo 内核重启失败", map[string]any{"error": safeAuditError(err)})
			return "", values, "", err
		}
		s.audit("core", "core.restart", "success", "Mihomo 内核已重启", nil)
		verifyTun()
		return "restarted", values, yaml, nil
	}
	// 新版 mihomo 要求 PUT /configs 的 path 为绝对路径
	if err := s.client.ReloadConfig(filepath.Join(s.dataDir, "config.yaml")); err != nil {
		// 热重载失败时退回重启内核，保证配置仍能生效
		if rerr := s.mgr.Restart(); rerr != nil {
			restoreAppliedConfig()
			s.audit("core", "core.restart", "error", "Mihomo 热重载失败且重启失败", map[string]any{"error": safeAuditError(rerr)})
			return "", values, "", fmt.Errorf("热重载失败: %v；重启内核也失败: %v", err, rerr)
		}
		s.audit("core", "core.restart", "success", "Mihomo 热重载失败，已通过重启恢复", nil)
		verifyTun()
		return "restarted", values, yaml, nil
	}
	return "reloaded", values, yaml, nil
}

// applyChangedConfig 将节点、订阅或规则的保存立即同步至内核。失败时保留编辑，
// 并在顶栏待应用清单中提供稍后重试入口。
func (s *Server) applyChangedConfig(scope string, fields []string) (string, string) {
	refreshRuleProviders := scope == "recognition_rules" || scope == "outbound_rules"
	result, err := s.applyAppliedConfig(refreshRuleProviders)
	if err == nil {
		_ = s.st.DeletePendingConfigChange(scope)
		return result, ""
	}
	_ = s.st.UpsertPendingConfigChange(store.PendingConfigChange{
		Scope: scope, Fields: fields, Status: store.PendingConfigStatusFailed, LastError: err.Error(),
	})
	return "", err.Error()
}

// writeAutoApplyResult 统一返回“数据已保存 + 自动应用结果”。自动应用失败不会回滚
// 用户刚保存的数据，而是交由顶栏的待应用清单重试。
func (s *Server) writeAutoApplyResult(w http.ResponseWriter, payload map[string]any, scope string, fields []string) {
	result, applyError := s.applyChangedConfig(scope, fields)
	payload["apply_result"] = result
	payload["apply_error"] = applyError
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleConfigApply(w http.ResponseWriter, r *http.Request) {
	result, err := s.applyConfig()
	if err != nil {
		writeErr(w, http.StatusBadGateway, "应用失败: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "result": result})
}
