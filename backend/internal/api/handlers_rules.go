package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

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
	tpl, err := s.st.GetActiveTemplate()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tpl == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"rules": []any{}, "providers": []any{}, "active_template": nil,
		})
		return
	}
	rules, _ := s.st.ListRules(tpl.ID)
	providers, _ := s.st.ListRuleProviders(tpl.ID)
	if rules == nil {
		rules = []model.Rule{}
	}
	if providers == nil {
		providers = []model.RuleProvider{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"rules": rules, "providers": providers,
		"active_template": map[string]any{"id": tpl.ID, "name": tpl.Name, "mapping": tpl.Mapping},
	})
}

func (s *Server) handlePutRules(w http.ResponseWriter, r *http.Request) {
	tpl, err := s.st.GetActiveTemplate()
	if err != nil || tpl == nil {
		writeErr(w, http.StatusBadRequest, "没有激活的模板")
		return
	}
	var req struct {
		Rules     []model.Rule         `json:"rules"`
		Providers []model.RuleProvider `json:"providers"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	for i := range req.Rules {
		rule := &req.Rules[i]
		if rule.Kind == "" {
			writeErr(w, http.StatusBadRequest, "存在缺少类型的规则")
			return
		}
		if rule.Target == "" {
			writeErr(w, http.StatusBadRequest, "存在缺少目标的规则")
			return
		}
		if rule.BaseTarget == "" {
			rule.BaseTarget = rule.Target
		}
		rule.TargetOverride = rule.Target != rule.BaseTarget
	}
	if err := s.st.ReplaceRules(tpl.ID, req.Rules, req.Providers); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.dirty.Store(true)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(req.Rules)})
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
		if tun, ok := running["tun"].(map[string]any); ok {
			enabled, _ := tun["enable"].(bool)
			if enabled != s.st.GetSettingBool("tun_enable", false) {
				needRestart = true
			}
		} else {
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
