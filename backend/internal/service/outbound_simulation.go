package service

import (
	"fmt"
	"net/netip"
	"regexp"
	"strings"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

// OutboundSimulationResult 是根据本地已保存配置与已下载数据得到的出站推演结果。
// 它不会解析 DNS、访问目标地址或下载远程规则源。
type OutboundSimulationResult struct {
	Target         string   `json:"target"`
	TargetType     string   `json:"target_type"` // domain | ip
	Certain        bool     `json:"certain"`
	RuleName       string   `json:"rule_name"`
	RuleKind       string   `json:"rule_kind"`
	RuleCondition  string   `json:"rule_condition,omitempty"`
	RulePriority   int      `json:"rule_priority"`
	OutboundTarget string   `json:"outbound_target"`
	Chain          []string `json:"chain"`
	Limitations    []string `json:"limitations"`
}

// SimulateOutbound 根据当前的识别规则、出站映射及有效节点组合推演目标流量的出站。
// 它会读取本机已有的 Geo 数据和 Mihomo 已下载的 YAML 规则集缓存，但不会对目标
// 发起 DNS 或 HTTP 请求，也不会为了测试而下载任何新规则。
func SimulateOutbound(st *store.Store, dataDir, rawTarget string) (*OutboundSimulationResult, error) {
	target, targetType, address, err := normalizeSimulationTarget(rawTarget)
	if err != nil {
		return nil, err
	}

	recognitions, err := st.ListRecognitionRules()
	if err != nil {
		return nil, err
	}
	outbounds, err := st.ListOutboundRules()
	if err != nil {
		return nil, err
	}
	nodes, err := EffectiveNodes(st)
	if err != nil {
		return nil, err
	}
	groups, err := st.ListGroups()
	if err != nil {
		return nil, err
	}

	outboundByRecognition := make(map[int64]model.OutboundRule, len(outbounds))
	for _, outbound := range outbounds {
		if outbound.Enabled {
			outboundByRecognition[outbound.RecognitionID] = outbound
		}
	}
	resolver := newRuleTargetResolver(nodes, groups)
	localData := newSimulationLocalData(dataDir)
	limitations := []string{}
	for _, recognition := range recognitions {
		if !recognition.Enabled {
			continue
		}
		outbound, mapped := outboundByRecognition[recognition.ID]
		if !mapped {
			continue
		}
		matched, evaluable, condition, limitation := simulationRuleMatches(localData, recognition, target, targetType, address)
		if !evaluable {
			limitations = appendSimulationLimitation(limitations, limitation)
			continue
		}
		if !matched {
			continue
		}
		return simulationResult(target, targetType, recognition, condition, resolveSimulationTarget(resolver, outbound.GroupID), limitations), nil
	}

	// 生成器会补上一条 MATCH 兜底；没有有效节点时该兜底会直接走 DIRECT。
	fallback := GroupPROXY
	if len(nodes) == 0 {
		fallback = model.BuiltinDirect
	}
	return &OutboundSimulationResult{
		Target:         target,
		TargetType:     targetType,
		Certain:        len(limitations) == 0,
		RuleName:       "内置 MATCH 兜底",
		RuleKind:       "MATCH",
		RulePriority:   0,
		OutboundTarget: fallback,
		Chain:          []string{"内置 MATCH 兜底", fallback},
		Limitations:    limitations,
	}, nil
}

func simulationResult(target, targetType string, recognition model.RecognitionRule, condition, outboundTarget string, limitations []string) *OutboundSimulationResult {
	return &OutboundSimulationResult{
		Target:         target,
		TargetType:     targetType,
		Certain:        len(limitations) == 0,
		RuleName:       recognition.Name,
		RuleKind:       recognition.Kind,
		RuleCondition:  condition,
		RulePriority:   recognition.Priority,
		OutboundTarget: outboundTarget,
		Chain:          []string{recognition.Name, outboundTarget},
		Limitations:    limitations,
	}
}

func resolveSimulationTarget(resolver *ruleTargetResolver, groupID int64) string {
	if target, builtin := model.BuiltinOutboundTarget(groupID); builtin {
		return target
	}
	return resolver.resolve(model.GroupTargetRef(groupID))
}

func normalizeSimulationTarget(rawTarget string) (target, targetType string, address netip.Addr, err error) {
	target = strings.TrimSpace(rawTarget)
	if target == "" {
		return "", "", netip.Addr{}, fmt.Errorf("请输入域名或 IP 地址")
	}
	if address, parseErr := netip.ParseAddr(target); parseErr == nil {
		return address.String(), "ip", address, nil
	}
	target = strings.TrimSuffix(strings.ToLower(target), ".")
	if !validSimulationDomain(target) {
		return "", "", netip.Addr{}, fmt.Errorf("目标必须是有效的域名或 IP 地址，不能包含协议、端口或路径")
	}
	return target, "domain", netip.Addr{}, nil
}

func validSimulationDomain(domain string) bool {
	if len(domain) == 0 || len(domain) > 253 {
		return false
	}
	for _, label := range strings.Split(domain, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, char := range label {
			if !(char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '-') {
				return false
			}
		}
	}
	return true
}

func simulationRuleMatches(localData *simulationLocalData, rule model.RecognitionRule, target, targetType string, address netip.Addr) (matched, evaluable bool, condition, limitation string) {
	kind := strings.ToUpper(strings.TrimSpace(rule.Kind))
	if kind == "MATCH" {
		return true, true, "", ""
	}
	if rule.SourceURL != "" || kind == "RULE-SET" {
		return localData.remoteRuleMatches(rule, target, targetType, address)
	}
	if kind == "GEOIP" || kind == "GEOSITE" {
		return localData.geoRuleMatches(kind, rule, target, targetType, address)
	}
	for _, value := range rule.Conditions {
		condition := strings.TrimSpace(value)
		if condition == "" {
			continue
		}
		switch kind {
		case "DOMAIN":
			if targetType == "domain" && target == strings.TrimSuffix(strings.ToLower(condition), ".") {
				return true, true, condition, ""
			}
		case "DOMAIN-SUFFIX":
			if targetType == "domain" {
				suffix := strings.TrimPrefix(strings.TrimSuffix(strings.ToLower(condition), "."), ".")
				if target == suffix || strings.HasSuffix(target, "."+suffix) {
					return true, true, condition, ""
				}
			}
		case "DOMAIN-KEYWORD":
			if targetType == "domain" && strings.Contains(target, strings.ToLower(condition)) {
				return true, true, condition, ""
			}
		case "DOMAIN-REGEX":
			if targetType == "domain" {
				if expression, err := regexp.Compile(condition); err == nil && expression.MatchString(target) {
					return true, true, condition, ""
				}
			}
		case "IP-CIDR", "IP-CIDR6":
			if targetType == "ip" {
				if prefix, err := netip.ParsePrefix(condition); err == nil && prefix.Contains(address) {
					return true, true, condition, ""
				}
			}
		default:
			return false, false, "", simulationLimitation(rule)
		}
	}
	return false, true, "", ""
}

func appendSimulationLimitation(limitations []string, limitation string) []string {
	limitation = strings.TrimSpace(limitation)
	if limitation == "" {
		return limitations
	}
	for _, item := range limitations {
		if item == limitation {
			return limitations
		}
	}
	return append(limitations, limitation)
}

func simulationLimitation(rule model.RecognitionRule) string {
	switch strings.ToUpper(rule.Kind) {
	case "GEOIP", "GEOSITE":
		return fmt.Sprintf("规则「%s」依赖 Geo 数据，离线模拟无法判定是否命中", rule.Name)
	case "RULE-SET":
		return fmt.Sprintf("规则「%s」依赖远程 YAML 规则源，离线模拟不会下载或读取其内容", rule.Name)
	default:
		return fmt.Sprintf("规则「%s」需要来源地址、端口或进程等额外上下文，离线模拟无法判定", rule.Name)
	}
}
