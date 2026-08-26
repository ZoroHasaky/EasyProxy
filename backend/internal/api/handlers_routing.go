package api

import (
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"easyproxy/internal/core"
	"easyproxy/internal/model"
	"easyproxy/internal/service"

	"gopkg.in/yaml.v3"
)

const defaultRuleProviderInterval = 86400

type geoRecognitionPresetDefinition struct {
	ID       string
	Name     string
	Kind     string
	DataKey  string
	Category string
}

var geoRecognitionPresetDefinitions = []geoRecognitionPresetDefinition{
	{ID: "private-ip", Name: "私有地址", Kind: "GEOIP", DataKey: "geoip", Category: "private"},
	{ID: "cn-ip", Name: "中国大陆 IP", Kind: "GEOIP", DataKey: "geoip", Category: "CN"},
	{ID: "private-domain", Name: "私有域名", Kind: "GEOSITE", DataKey: "geosite", Category: "private"},
	{ID: "cn-domain", Name: "中国大陆域名", Kind: "GEOSITE", DataKey: "geosite", Category: "cn"},
	{ID: "ads", Name: "广告服务", Kind: "GEOSITE", DataKey: "geosite", Category: "category-ads-all"},
	{ID: "google", Name: "Google 服务", Kind: "GEOSITE", DataKey: "geosite", Category: "google"},
	{ID: "apple", Name: "Apple 服务", Kind: "GEOSITE", DataKey: "geosite", Category: "apple"},
	{ID: "microsoft", Name: "Microsoft 服务", Kind: "GEOSITE", DataKey: "geosite", Category: "microsoft"},
	{ID: "github", Name: "GitHub", Kind: "GEOSITE", DataKey: "geosite", Category: "github"},
	{ID: "openai", Name: "OpenAI", Kind: "GEOSITE", DataKey: "geosite", Category: "openai"},
	{ID: "telegram", Name: "Telegram", Kind: "GEOSITE", DataKey: "geosite", Category: "telegram"},
}

type geoRecognitionPreset struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Condition string `json:"condition"`
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

type geoRecognitionPresetCatalog struct {
	Available bool                   `json:"available"`
	Message   string                 `json:"message,omitempty"`
	Presets   []geoRecognitionPreset `json:"presets"`
}

type generateGeoRecognitionRulesRequest struct {
	PresetIDs []string `json:"preset_ids"`
}

type geoRecognitionGenerationSkip struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

func (s *Server) geoRecognitionPresets() geoRecognitionPresetCatalog {
	catalog := geoRecognitionPresetCatalog{Presets: make([]geoRecognitionPreset, 0, len(geoRecognitionPresetDefinitions))}
	if !s.st.GetSettingBool("geo_enabled", true) {
		catalog.Message = "Geo 数据未启用，请先在 Geo 数据页面启用、应用并更新数据"
		for _, definition := range geoRecognitionPresetDefinitions {
			catalog.Presets = append(catalog.Presets, geoRecognitionPreset{
				ID: definition.ID, Name: definition.Name, Kind: definition.Kind, Condition: definition.Category,
				Reason: "Geo 数据未启用",
			})
		}
		return catalog
	}

	sets := service.GeoDataCategorySets(s.dataDir)
	for _, definition := range geoRecognitionPresetDefinitions {
		preset := geoRecognitionPreset{
			ID: definition.ID, Name: definition.Name, Kind: definition.Kind, Condition: definition.Category,
		}
		set := sets[definition.DataKey]
		if set.Err != nil {
			preset.Reason = map[string]string{"geoip": "GeoIP 数据未就绪", "geosite": "GeoSite 数据未就绪"}[definition.DataKey]
		} else if condition, ok := set.Lookup(definition.Category); ok {
			preset.Condition = condition
			preset.Available = true
			catalog.Available = true
		} else {
			preset.Reason = fmt.Sprintf("当前数据中未找到 %s 分类", definition.Category)
		}
		catalog.Presets = append(catalog.Presets, preset)
	}
	if !catalog.Available {
		catalog.Message = "未检测到可用于生成规则的 Geo 数据，请先在 Geo 数据页面手动更新"
	}
	return catalog
}

func recognitionConditionKey(kind, condition string) string {
	return strings.ToUpper(strings.TrimSpace(kind)) + "\x00" + strings.ToLower(strings.TrimSpace(condition))
}

func (s *Server) rejectGeoRecognitionGeneration(w http.ResponseWriter, status int, message string) {
	s.audit("operation", "routing.geo_generate", "warning", "根据 Geo 数据生成识别规则未执行", map[string]any{"reason": message})
	writeErr(w, status, message)
}

// handleGetGeoRecognitionPresets 根据实际已拉取的 Geo 数据返回可生成的常用规则。
func (s *Server) handleGetGeoRecognitionPresets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.geoRecognitionPresets())
}

// handleGenerateGeoRecognitionRules 仅接受预置 ID，并在服务端再次验证 Geo 数据与分类。
// 它只新增识别规则，不创建出站映射，因此不会直接改变流量的最终出站。
func (s *Server) handleGenerateGeoRecognitionRules(w http.ResponseWriter, r *http.Request) {
	var req generateGeoRecognitionRulesRequest
	if err := readJSON(r, &req); err != nil || len(req.PresetIDs) == 0 {
		s.rejectGeoRecognitionGeneration(w, http.StatusBadRequest, "请选择至少一条 Geo 预置规则")
		return
	}

	catalog := s.geoRecognitionPresets()
	byID := make(map[string]geoRecognitionPreset, len(catalog.Presets))
	for _, preset := range catalog.Presets {
		byID[preset.ID] = preset
	}
	selected := make([]geoRecognitionPreset, 0, len(req.PresetIDs))
	seenIDs := map[string]bool{}
	for _, id := range req.PresetIDs {
		id = strings.TrimSpace(id)
		if id == "" || seenIDs[id] {
			continue
		}
		preset, ok := byID[id]
		if !ok {
			s.rejectGeoRecognitionGeneration(w, http.StatusBadRequest, "包含未知的 Geo 预置规则")
			return
		}
		if !preset.Available {
			s.rejectGeoRecognitionGeneration(w, http.StatusConflict, "预置规则「"+preset.Name+"」当前不可用："+preset.Reason)
			return
		}
		seenIDs[id] = true
		selected = append(selected, preset)
	}
	if len(selected) == 0 {
		s.rejectGeoRecognitionGeneration(w, http.StatusBadRequest, "请选择至少一条 Geo 预置规则")
		return
	}
	if !catalog.Available {
		s.rejectGeoRecognitionGeneration(w, http.StatusConflict, catalog.Message)
		return
	}

	existing, err := s.st.ListRecognitionRules()
	if err != nil {
		s.audit("operation", "routing.geo_generate", "error", "根据 Geo 数据生成识别规则失败", map[string]any{"error": safeAuditError(err)})
		writeErr(w, http.StatusInternalServerError, "读取现有识别规则失败")
		return
	}
	existingNames := map[string]bool{}
	existingConditions := map[string]bool{}
	for _, rule := range existing {
		existingNames[strings.ToLower(strings.TrimSpace(rule.Name))] = true
		for _, condition := range rule.Conditions {
			existingConditions[recognitionConditionKey(rule.Kind, condition)] = true
		}
	}

	candidates := make([]model.RecognitionRule, 0, len(selected))
	skipped := make([]geoRecognitionGenerationSkip, 0)
	for _, preset := range selected {
		conditionKey := recognitionConditionKey(preset.Kind, preset.Condition)
		if existingConditions[conditionKey] {
			skipped = append(skipped, geoRecognitionGenerationSkip{ID: preset.ID, Reason: "已存在相同类型与条件的识别规则"})
			continue
		}
		name := "Geo · " + preset.Name
		if existingNames[strings.ToLower(name)] {
			skipped = append(skipped, geoRecognitionGenerationSkip{ID: preset.ID, Reason: "规则名称已被占用"})
			continue
		}
		candidates = append(candidates, model.RecognitionRule{
			Name: name, Kind: preset.Kind, Conditions: []string{preset.Condition}, Priority: 1, Enabled: true,
		})
		existingNames[strings.ToLower(name)] = true
		existingConditions[conditionKey] = true
	}

	if len(candidates) == 0 {
		s.audit("operation", "routing.geo_generate", "info", "根据 Geo 数据未生成新的识别规则", map[string]any{"created": 0, "skipped": len(skipped)})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": 0, "created": []model.RecognitionRule{}, "skipped": skipped, "apply_result": "", "apply_error": ""})
		return
	}
	created, err := s.st.CreateRecognitionRules(candidates)
	if err != nil {
		s.rejectGeoRecognitionGeneration(w, http.StatusBadRequest, err.Error())
		return
	}
	result, applyError := s.applyChangedConfig("recognition_rules", []string{"识别规则"})
	level, summary := "success", "已根据 Geo 数据生成识别规则"
	details := map[string]any{"created": len(created), "skipped": len(skipped)}
	if applyError != "" {
		level, summary = "warning", "已根据 Geo 数据生成识别规则，但自动应用失败"
		details["error"] = safeAuditError(fmt.Errorf("%s", applyError))
	}
	s.audit("operation", "routing.geo_generate", level, summary, details)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "count": len(created), "created": created, "skipped": skipped,
		"apply_result": result, "apply_error": applyError,
	})
}

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

type standaloneYAMLRuleFile struct {
	Payload yaml.Node `yaml:"payload"`
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
	sourceURL := model.NormalizeGitHubContentURL(provider.URL)
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
		if len(config.RuleProviders) > 0 {
			for name, provider := range config.RuleProviders {
				rule, err := importedRecognitionRule(name, provider, req.Priority, enabled)
				if err != nil {
					writeErr(w, http.StatusBadRequest, err.Error())
					return
				}
				candidates = append(candidates, rule)
			}
		} else {
			// MetaCubeX 的 geo/geosite/*.yaml 等文件是单个 Rule Provider 的内容，
			// 只有 payload，不带 rule-providers 外层配置。其来源 URL 仍需保存，
			// 以便 Mihomo 后续按周期拉取更新。
			var ruleFile standaloneYAMLRuleFile
			if err := yaml.Unmarshal([]byte(content), &ruleFile); err != nil {
				writeErr(w, http.StatusBadRequest, "YAML 规则文件解析失败: "+err.Error())
				return
			}
			if ruleFile.Payload.Kind != yaml.SequenceNode {
				writeErr(w, http.StatusBadRequest, "未找到 rule-providers 配置，也不是包含 payload 的 YAML 规则文件")
				return
			}
			behavior := strings.TrimSpace(req.Behavior)
			if behavior == "" {
				behavior = "domain"
			}
			name := strings.TrimSpace(req.Name)
			if name == "" {
				name = sourceRuleNameFromURL(req.URL)
			}
			rule, err := importedRecognitionRule(name, importedYAMLProvider{
				Type:     "http",
				Behavior: behavior,
				URL:      req.URL,
				Format:   "yaml",
				Interval: req.Interval,
			}, req.Priority, enabled)
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

// handleSimulateOutbound 仅根据已保存的规则与映射推演出站路径；不会请求目标地址。
func (s *Server) handleSimulateOutbound(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Target string `json:"target"`
	}
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	result, err := service.SimulateOutbound(s.st, req.Target)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	s.expandSimulationRuntimeChain(result)
	writeJSON(w, http.StatusOK, result)
}

// expandSimulationRuntimeChain 只读取本地 Mihomo 的当前策略组选择，用于把配置目标
// 继续展开到当前实际节点；不会发起任何对用户测试目标的网络访问。
func (s *Server) expandSimulationRuntimeChain(result *service.OutboundSimulationResult) {
	if result.OutboundTarget == model.BuiltinDirect || result.OutboundTarget == model.BuiltinReject || s.mgr.Status().State != core.StateRunning {
		return
	}
	proxies, err := s.client.GetProxies()
	if err != nil {
		result.Limitations = append(result.Limitations, "无法读取内核当前选择，链路仅展示到配置出站目标")
		return
	}
	current := result.OutboundTarget
	seen := map[string]bool{current: true}
	for range 8 { // 防止异常配置形成循环引用。
		next := strings.TrimSpace(proxies[current].Now)
		if next == "" || seen[next] {
			return
		}
		result.Chain = append(result.Chain, next)
		seen[next] = true
		current = next
	}
}

// refreshActiveRecognitionRuleProviders 强制更新所有已启用且已映射的远程规则源。
// Mihomo 在 Provider 尚未下载完成时会跳过 RULE-SET 并继续匹配后续 MATCH，因此保存
// 识别规则后必须主动触发更新，不能只等待最长 24 小时的更新周期。
func (s *Server) refreshActiveRecognitionRuleProviders() error {
	if s.mgr.Status().State != core.StateRunning {
		return nil
	}
	recognitions, err := s.st.ListRecognitionRules()
	if err != nil {
		return err
	}
	outbounds, err := s.st.ListOutboundRules()
	if err != nil {
		return err
	}
	mapped := make(map[int64]bool, len(outbounds))
	for _, outbound := range outbounds {
		if outbound.Enabled {
			mapped[outbound.RecognitionID] = true
		}
	}
	for _, recognition := range recognitions {
		if !recognition.Enabled || recognition.SourceURL == "" || !mapped[recognition.ID] {
			continue
		}
		var lastErr error
		for attempt := 0; attempt < 5; attempt++ {
			if err := s.client.UpdateRuleProvider(recognition.Name); err == nil {
				lastErr = nil
				break
			} else {
				lastErr = err
			}
			if attempt < 4 {
				time.Sleep(250 * time.Millisecond)
			}
		}
		if lastErr != nil {
			return fmt.Errorf("更新识别规则源「%s」失败: %w", recognition.Name, lastErr)
		}
	}
	return nil
}

// refreshRecognitionRuleProvidersAfterCoreStart 等待控制器就绪后刷新规则源。
func (s *Server) refreshRecognitionRuleProvidersAfterCoreStart() {
	go func() {
		if err := s.refreshActiveRecognitionRuleProviders(); err != nil {
			s.audit("core", "core.rule_provider_refresh", "error", "识别规则源刷新失败", map[string]any{"error": safeAuditError(err)})
		}
	}()
}
