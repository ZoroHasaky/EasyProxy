package api

import (
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"

	"easyproxy/internal/model"

	"gopkg.in/yaml.v3"
)

const defaultRuleProviderInterval = 86400

type recognitionRuleImportRequest struct {
	URL      string `json:"url"`
	Content  string `json:"content"`
	Name     string `json:"name"`
	Behavior string `json:"behavior"`
	Interval int    `json:"interval"`
	Priority int    `json:"priority"`
	Enabled  *bool  `json:"enabled"`
	Preview  bool   `json:"preview"`
}

type importedYAMLProvider struct {
	Type     string `yaml:"type"`
	Behavior string `yaml:"behavior"`
	URL      string `yaml:"url"`
	Format   string `yaml:"format"`
	Interval int    `yaml:"interval"`
}

func sourceRuleNameFromURL(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	name, err := url.PathUnescape(path.Base(parsed.Path))
	if err != nil {
		return ""
	}
	if strings.HasSuffix(strings.ToLower(name), ".yaml") {
		name = name[:len(name)-len(".yaml")]
	}
	return strings.TrimSpace(name)
}

func importedRecognitionRule(name string, provider importedYAMLProvider, priority int, enabled bool) (model.RecognitionRule, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return model.RecognitionRule{}, fmt.Errorf("YAML 规则源名称不能为空")
	}
	if !strings.EqualFold(strings.TrimSpace(provider.Type), "http") {
		return model.RecognitionRule{}, fmt.Errorf("识别规则「%s」仅支持 HTTP 类型的 YAML 来源", name)
	}
	format := strings.ToLower(strings.TrimSpace(provider.Format))
	if format != "" && format != "yaml" {
		return model.RecognitionRule{}, fmt.Errorf("识别规则「%s」仅支持 YAML 格式，不支持 %s", name, format)
	}
	sourceURL := strings.TrimSpace(provider.URL)
	parsedURL, err := url.Parse(sourceURL)
	if err != nil || parsedURL.Host == "" || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return model.RecognitionRule{}, fmt.Errorf("识别规则「%s」的 YAML 来源 URL 无效", name)
	}
	if strings.HasSuffix(strings.ToLower(parsedURL.Path), ".mrs") {
		return model.RecognitionRule{}, fmt.Errorf("识别规则「%s」不再支持 MRS 来源", name)
	}
	behavior := strings.ToLower(strings.TrimSpace(provider.Behavior))
	if behavior != "domain" && behavior != "ipcidr" && behavior != "classical" {
		return model.RecognitionRule{}, fmt.Errorf("识别规则「%s」的 YAML 匹配类型无效", name)
	}
	interval := provider.Interval
	if interval < 0 {
		return model.RecognitionRule{}, fmt.Errorf("识别规则「%s」的更新周期不能小于 0", name)
	}
	if interval == 0 {
		interval = defaultRuleProviderInterval
	}
	return model.RecognitionRule{
		Name:           name,
		Kind:           "RULE-SET",
		Conditions:     []string{},
		SourceURL:      sourceURL,
		SourceBehavior: behavior,
		SourceInterval: interval,
		Priority:       priority,
		Enabled:        enabled,
	}, nil
}

// handleImportRecognitionRules 只保存 YAML Rule Provider 的元数据；规则文件由 mihomo 后续自行下载与更新。
func (s *Server) handleImportRecognitionRules(w http.ResponseWriter, r *http.Request) {
	var req recognitionRuleImportRequest
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	var candidates []model.RecognitionRule
	if content := strings.TrimSpace(req.Content); content != "" {
		var config struct {
			RuleProviders map[string]importedYAMLProvider `yaml:"rule-providers"`
		}
		if err := yaml.Unmarshal([]byte(content), &config); err != nil {
			writeErr(w, http.StatusBadRequest, "YAML 配置解析失败: "+err.Error())
			return
		}
		if len(config.RuleProviders) == 0 {
			writeErr(w, http.StatusBadRequest, "未找到 rule-providers 配置")
			return
		}
		for name, provider := range config.RuleProviders {
			rule, err := importedRecognitionRule(name, provider, req.Priority, enabled)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
			candidates = append(candidates, rule)
		}
	} else {
		behavior := strings.TrimSpace(req.Behavior)
		if behavior == "" {
			behavior = "domain"
		}
		provider := importedYAMLProvider{
			Type:     "http",
			Behavior: behavior,
			URL:      req.URL,
			Format:   "yaml",
			Interval: req.Interval,
		}
		name := strings.TrimSpace(req.Name)
		if name == "" {
			name = sourceRuleNameFromURL(req.URL)
		}
		rule, err := importedRecognitionRule(name, provider, req.Priority, enabled)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		candidates = append(candidates, rule)
	}
	if req.Preview {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(candidates), "rules": candidates})
		return
	}

	created, err := s.st.CreateRecognitionRules(candidates)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	result, applyError := s.applyChangedConfig("recognition_rules", []string{"识别规则"})
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "count": len(created), "rules": created,
		"apply_result": result, "apply_error": applyError,
	})
}

func (s *Server) handleGetRecognitionRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.st.ListRecognitionRules()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

func (s *Server) handlePutRecognitionRules(w http.ResponseWriter, r *http.Request) {
	var rules []model.RecognitionRule
	if err := readJSON(r, &rules); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := s.st.ReplaceRecognitionRules(rules); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	result, applyError := s.applyChangedConfig("recognition_rules", []string{"识别规则"})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(rules), "apply_result": result, "apply_error": applyError})
}

func (s *Server) handleGetOutboundRules(w http.ResponseWriter, r *http.Request) {
	rules, err := s.st.ListOutboundRules()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

func (s *Server) handlePutOutboundRules(w http.ResponseWriter, r *http.Request) {
	var rules []model.OutboundRule
	if err := readJSON(r, &rules); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := s.st.ReplaceOutboundRules(rules); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	result, applyError := s.applyChangedConfig("outbound_rules", []string{"出站映射"})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(rules), "apply_result": result, "apply_error": applyError})
}
