package service

import (
	"fmt"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"easyproxy/internal/model"
	"easyproxy/internal/parser"
	"easyproxy/internal/store"
)

// ParsedTemplate 模板解析结果
type ParsedTemplate struct {
	Rules     []model.Rule
	Providers []model.RuleProvider
	Targets   []string // 模板中引用的非内置目标名（去重有序）
}

type RuleProviderContent struct {
	Items []string `json:"items"`
	Total int      `json:"total"`
	Page  int      `json:"page"`
	Size  int      `json:"size"`
}

// ParseTemplateContent 解析模板 YAML 中的 rules 与 rule-providers
func ParseTemplateContent(content string) (*ParsedTemplate, error) {
	var doc struct {
		Rules         []string `yaml:"rules"`
		RuleProviders map[string]struct {
			Behavior string `yaml:"behavior"`
			Format   string `yaml:"format"`
			URL      string `yaml:"url"`
			Interval int    `yaml:"interval"`
		} `yaml:"rule-providers"`
	}
	if err := yaml.Unmarshal([]byte(content), &doc); err != nil {
		return nil, fmt.Errorf("模板不是有效的 YAML: %w", err)
	}
	if len(doc.Rules) == 0 {
		return nil, fmt.Errorf("模板中未找到 rules 字段")
	}
	out := &ParsedTemplate{
		Rules:     []model.Rule{},
		Providers: []model.RuleProvider{},
		Targets:   []string{},
	}
	seenTarget := map[string]bool{}
	for _, line := range doc.Rules {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Split(line, ",")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		kind := strings.ToUpper(parts[0])
		noResolve := false
		if len(parts) > 1 && parts[len(parts)-1] == "no-resolve" {
			noResolve = true
			parts = parts[:len(parts)-1]
		}
		r := model.Rule{Kind: kind, NoResolve: noResolve, Enabled: true}
		switch {
		case kind == "MATCH" && len(parts) >= 2:
			r.Target = parts[1]
		case len(parts) >= 3:
			r.Value = strings.Join(parts[1:len(parts)-1], ",")
			r.Target = parts[len(parts)-1]
		default:
			continue // 无法解析的行跳过
		}
		if !model.IsBuiltinTarget(r.Target) && !seenTarget[r.Target] {
			seenTarget[r.Target] = true
			out.Targets = append(out.Targets, r.Target)
		}
		out.Rules = append(out.Rules, r)
	}
	if len(out.Rules) == 0 {
		return nil, fmt.Errorf("模板中未解析到有效规则")
	}
	for name, p := range doc.RuleProviders {
		if p.URL == "" {
			continue
		}
		behavior := p.Behavior
		if behavior == "" {
			behavior = "domain"
		}
		format := p.Format
		if format == "" {
			format = "yaml"
		}
		interval := p.Interval
		if interval <= 0 {
			interval = 86400
		}
		out.Providers = append(out.Providers, model.RuleProvider{
			Name: name, URL: p.URL, Behavior: behavior, Format: format, Interval: interval,
		})
	}
	sort.Slice(out.Providers, func(i, j int) bool { return out.Providers[i].Name < out.Providers[j].Name })
	return out, nil
}

// ParseRuleProviderContent 将 YAML/Text 规则集转换为可分页展示的文本条目。
func ParseRuleProviderContent(content, format, query string, page, size int) (*RuleProviderContent, error) {
	var items []string
	switch strings.ToLower(format) {
	case "yaml", "yml":
		var doc struct {
			Payload []any `yaml:"payload"`
		}
		if err := yaml.Unmarshal([]byte(content), &doc); err != nil {
			return nil, fmt.Errorf("规则集不是有效的 YAML: %w", err)
		}
		for _, item := range doc.Payload {
			value := strings.TrimSpace(fmt.Sprint(item))
			if value != "" {
				items = append(items, value)
			}
		}
	case "text":
		for _, line := range strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				items = append(items, line)
			}
		}
	default:
		return nil, fmt.Errorf("%s 格式不支持展开", format)
	}
	if q := strings.ToLower(strings.TrimSpace(query)); q != "" {
		filtered := make([]string, 0, len(items))
		for _, item := range items {
			if strings.Contains(strings.ToLower(item), q) {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 100
	}
	if size > 500 {
		size = 500
	}
	total := len(items)
	start := (page - 1) * size
	if start > total {
		start = total
	}
	end := start + size
	if end > total {
		end = total
	}
	return &RuleProviderContent{Items: items[start:end], Total: total, Page: page, Size: size}, nil
}

func RegionGroupName(code string) string {
	return parser.RegionFlag(code) + " " + parser.RegionCN(code)
}

// SuggestMapping 为模板目标名猜测映射：内置/地区/兜底 PROXY
func SuggestMapping(target string, groups []model.Group) string {
	t := strings.ToLower(target)
	containsAny := func(kws ...string) bool {
		for _, kw := range kws {
			if strings.Contains(t, strings.ToLower(kw)) {
				return true
			}
		}
		return false
	}
	switch {
	case containsAny("reject", "广告", "去广告", "ad", "block", "privacy", "隐私", "tracker", "跟踪", "劫持"):
		return model.BuiltinReject
	case containsAny("direct", "直连", "bypass", "绕过", "国内"):
		return model.BuiltinDirect
	case containsAny("自动选择", "auto", "自动", "延迟", "测速"):
		return GroupAUTO
	case containsAny("节点选择", "手动", "proxy", "翻墙", "机场", "选择", "select", "故障转移", "负载", "load", "fallback", "国外", "科学"):
		return GroupPROXY
	}
	if region := parser.ParseRegion(target); region != parser.RegionOther {
		for _, g := range groups {
			if g.Region == region {
				return model.GroupTargetRef(g.ID)
			}
		}
		return GroupPROXY
	}
	return GroupPROXY
}

// ApplyTemplateRules 按映射将模板规则落入 rules 表；映射缺失项自动补建议值
func ApplyTemplateRules(st *store.Store, tpl *model.Template) error {
	parsed, err := ParseTemplateContent(tpl.Content)
	if err != nil {
		return err
	}
	existing, err := st.ListRules(tpl.ID)
	if err != nil {
		return err
	}
	groups, err := st.ListGroups()
	if err != nil {
		return err
	}
	if tpl.Mapping == nil {
		tpl.Mapping = map[string]string{}
	}
	for _, t := range parsed.Targets {
		if _, ok := tpl.Mapping[t]; !ok {
			tpl.Mapping[t] = SuggestMapping(t, groups)
		}
	}
	overrides := map[string][]model.Rule{}
	for _, r := range existing {
		if r.TargetOverride {
			key := ruleIdentity(r)
			overrides[key] = append(overrides[key], r)
		}
	}
	rules := make([]model.Rule, 0, len(parsed.Rules))
	for _, r := range parsed.Rules {
		if !model.IsBuiltinTarget(r.Target) {
			if mapped, ok := tpl.Mapping[r.Target]; ok && mapped != "" {
				r.Target = mapped
			} else {
				r.Target = GroupPROXY
			}
		}
		r.BaseTarget = r.Target
		if queue := overrides[ruleIdentity(r)]; len(queue) > 0 {
			r.Target = queue[0].Target
			r.TargetOverride = r.Target != r.BaseTarget
			overrides[ruleIdentity(r)] = queue[1:]
		}
		r.TemplateID = tpl.ID
		rules = append(rules, r)
	}
	if err := st.ReplaceRules(tpl.ID, rules, parsed.Providers); err != nil {
		return err
	}
	return st.UpdateTemplate(tpl)
}

func ruleIdentity(r model.Rule) string {
	return fmt.Sprintf("%s\x00%s\x00%t", strings.ToUpper(r.Kind), r.Value, r.NoResolve)
}

// GenerateRegionGroups 为节点池中出现的地区补齐地区分组（url-test 速度优先）
func GenerateRegionGroups(st *store.Store) ([]string, error) {
	nodes, err := st.ListNodes(model.NodeFilter{})
	if err != nil {
		return nil, err
	}
	groups, err := st.ListGroups()
	if err != nil {
		return nil, err
	}
	usedNames := map[string]bool{}
	usedRegions := map[string]bool{}
	for _, g := range groups {
		usedNames[g.Name] = true
		if g.Region != "" {
			usedRegions[g.Region] = true
		}
	}
	regions := map[string]bool{}
	for _, n := range nodes {
		if n.Region != "" && n.Region != parser.RegionOther {
			regions[n.Region] = true
		}
	}
	codes := make([]string, 0, len(regions))
	for code := range regions {
		codes = append(codes, code)
	}
	sortStrings(codes)

	created := []string{}
	newGroups := make([]model.Group, len(groups))
	copy(newGroups, groups)
	for _, code := range codes {
		if usedRegions[code] {
			continue
		}
		name := RegionGroupName(code)
		for usedNames[name] {
			name = name + "+"
		}
		usedNames[name] = true
		newGroups = append(newGroups, model.Group{
			Name: name, Type: "url-test", Region: code,
			Interval: 300, Tolerance: 50, Icon: parser.RegionFlag(code), Enabled: true,
		})
		created = append(created, name)
	}
	if len(created) > 0 {
		if err := st.ReplaceGroups(newGroups); err != nil {
			return nil, err
		}
	}
	return created, nil
}

func sortStrings(ss []string) {
	for i := 1; i < len(ss); i++ {
		for j := i; j > 0 && ss[j] < ss[j-1]; j-- {
			ss[j], ss[j-1] = ss[j-1], ss[j]
		}
	}
}
