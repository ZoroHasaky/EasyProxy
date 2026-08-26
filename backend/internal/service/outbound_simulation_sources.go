package service

import (
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"easyproxy/internal/model"

	"gopkg.in/yaml.v3"
)

// simulationLocalData 缓存一次推演期间读取的本地数据；不会产生网络请求。
type simulationLocalData struct {
	dataDir string

	geoIPLoaded bool
	geoIP       simulationGeoIPData
	geoIPErr    error

	geoSiteLoaded bool
	geoSite       simulationGeoSiteData
	geoSiteErr    error
}

type simulationGeoIPData struct {
	categories map[string]simulationGeoIPCategory
}

type simulationGeoIPCategory struct {
	prefixes []netip.Prefix
	inverse  bool
}

type simulationGeoSiteData struct {
	categories map[string][]simulationGeoSiteDomain
}

type simulationGeoSiteDomain struct {
	kind  uint64
	value string
}

func newSimulationLocalData(dataDir string) *simulationLocalData {
	return &simulationLocalData{dataDir: dataDir}
}

func (data *simulationLocalData) geoRuleMatches(kind string, rule model.RecognitionRule, target, targetType string, address netip.Addr) (matched, evaluable bool, condition, limitation string) {
	switch kind {
	case "GEOIP":
		if targetType != "ip" {
			return false, false, "", fmt.Sprintf("规则「%s」需要目标 IP 才能匹配 GeoIP；离线模拟不会为域名解析 DNS", rule.Name)
		}
		geoIP, err := data.loadGeoIP()
		if err != nil {
			return false, false, "", fmt.Sprintf("规则「%s」依赖本机 GeoIP 数据，但 GeoIP.dat 不可用：%s", rule.Name, err)
		}
		for _, rawCondition := range rule.Conditions {
			condition = strings.TrimSpace(rawCondition)
			category, exists := geoIP.categories[strings.ToLower(condition)]
			if !exists {
				return false, false, "", fmt.Sprintf("规则「%s」指定的 GeoIP 分类「%s」不在当前本地数据中", rule.Name, condition)
			}
			if category.matches(address) {
				return true, true, condition, ""
			}
		}
		return false, true, "", ""
	case "GEOSITE":
		if targetType != "domain" {
			return false, true, "", ""
		}
		geoSite, err := data.loadGeoSite()
		if err != nil {
			return false, false, "", fmt.Sprintf("规则「%s」依赖本机 GeoSite 数据，但 GeoSite.dat 不可用：%s", rule.Name, err)
		}
		for _, rawCondition := range rule.Conditions {
			condition = strings.TrimSpace(rawCondition)
			entries, exists := geoSite.categories[strings.ToLower(condition)]
			if !exists {
				return false, false, "", fmt.Sprintf("规则「%s」指定的 GeoSite 分类「%s」不在当前本地数据中", rule.Name, condition)
			}
			if geoSiteEntriesMatch(entries, target) {
				return true, true, condition, ""
			}
		}
		return false, true, "", ""
	default:
		return false, false, "", simulationLimitation(rule)
	}
}

func (category simulationGeoIPCategory) matches(address netip.Addr) bool {
	matched := false
	for _, prefix := range category.prefixes {
		if prefix.Contains(address) {
			matched = true
			break
		}
	}
	if category.inverse {
		return !matched
	}
	return matched
}

// v2ray/MetaCubeX GeoSite Domain.Type: Plain=0、Regex=1、Domain=2、Full=3。
func geoSiteEntriesMatch(entries []simulationGeoSiteDomain, target string) bool {
	for _, entry := range entries {
		value := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(entry.value)), ".")
		if value == "" {
			continue
		}
		switch entry.kind {
		case 0: // Plain
			if strings.Contains(target, value) {
				return true
			}
		case 1: // Regex
			if expression, err := regexp.Compile(entry.value); err == nil && expression.MatchString(target) {
				return true
			}
		case 2: // Domain
			if target == value || strings.HasSuffix(target, "."+value) {
				return true
			}
		case 3: // Full
			if target == value {
				return true
			}
		}
	}
	return false
}

func (data *simulationLocalData) loadGeoIP() (simulationGeoIPData, error) {
	if data.geoIPLoaded {
		return data.geoIP, data.geoIPErr
	}
	data.geoIPLoaded = true
	path, _ := geoDataPath(data.dataDir, "GeoIP.dat")
	data.geoIP, data.geoIPErr = parseSimulationGeoIP(path)
	return data.geoIP, data.geoIPErr
}

func (data *simulationLocalData) loadGeoSite() (simulationGeoSiteData, error) {
	if data.geoSiteLoaded {
		return data.geoSite, data.geoSiteErr
	}
	data.geoSiteLoaded = true
	path, _ := geoDataPath(data.dataDir, "GeoSite.dat")
	data.geoSite, data.geoSiteErr = parseSimulationGeoSite(path)
	return data.geoSite, data.geoSiteErr
}

func parseSimulationGeoIP(path string) (simulationGeoIPData, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return simulationGeoIPData{}, err
	}
	result := simulationGeoIPData{categories: map[string]simulationGeoIPCategory{}}
	err = scanProtoFieldValues(raw, func(field, wire int, number uint64, value []byte) error {
		if field != 1 || wire != 2 {
			return nil
		}
		name, category, err := parseSimulationGeoIPCategory(value)
		if err != nil {
			return err
		}
		if name != "" {
			result.categories[strings.ToLower(name)] = category
		}
		return nil
	})
	if err != nil {
		return simulationGeoIPData{}, err
	}
	if len(result.categories) == 0 {
		return simulationGeoIPData{}, fmt.Errorf("未找到 GeoIP 分类")
	}
	return result, nil
}

func parseSimulationGeoIPCategory(raw []byte) (string, simulationGeoIPCategory, error) {
	var name string
	category := simulationGeoIPCategory{}
	err := scanProtoFieldValues(raw, func(field, wire int, number uint64, value []byte) error {
		switch {
		case field == 1 && wire == 2:
			name = strings.TrimSpace(string(value))
		case field == 2 && wire == 2:
			prefix, err := parseSimulationGeoIPPrefix(value)
			if err != nil {
				return err
			}
			category.prefixes = append(category.prefixes, prefix)
		case field == 3 && wire == 0:
			category.inverse = number != 0
		}
		return nil
	})
	return name, category, err
}

func parseSimulationGeoIPPrefix(raw []byte) (netip.Prefix, error) {
	var rawIP []byte
	prefixLength := -1
	err := scanProtoFieldValues(raw, func(field, wire int, number uint64, value []byte) error {
		switch {
		case field == 1 && wire == 2:
			rawIP = append([]byte(nil), value...)
		case field == 2 && wire == 0:
			if number > 128 {
				return fmt.Errorf("CIDR 前缀长度无效")
			}
			prefixLength = int(number)
		}
		return nil
	})
	if err != nil {
		return netip.Prefix{}, err
	}
	address, ok := netip.AddrFromSlice(rawIP)
	if !ok {
		return netip.Prefix{}, fmt.Errorf("CIDR IP 地址无效")
	}
	if prefixLength < 0 {
		prefixLength = address.BitLen()
	}
	if prefixLength > address.BitLen() {
		return netip.Prefix{}, fmt.Errorf("CIDR 前缀长度超出地址位数")
	}
	return netip.PrefixFrom(address, prefixLength).Masked(), nil
}

func parseSimulationGeoSite(path string) (simulationGeoSiteData, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return simulationGeoSiteData{}, err
	}
	result := simulationGeoSiteData{categories: map[string][]simulationGeoSiteDomain{}}
	err = scanProtoFieldValues(raw, func(field, wire int, number uint64, value []byte) error {
		if field != 1 || wire != 2 {
			return nil
		}
		name, entries, err := parseSimulationGeoSiteCategory(value)
		if err != nil {
			return err
		}
		if name != "" {
			result.categories[strings.ToLower(name)] = entries
		}
		return nil
	})
	if err != nil {
		return simulationGeoSiteData{}, err
	}
	if len(result.categories) == 0 {
		return simulationGeoSiteData{}, fmt.Errorf("未找到 GeoSite 分类")
	}
	return result, nil
}

func parseSimulationGeoSiteCategory(raw []byte) (string, []simulationGeoSiteDomain, error) {
	var name string
	entries := []simulationGeoSiteDomain{}
	err := scanProtoFieldValues(raw, func(field, wire int, number uint64, value []byte) error {
		switch {
		case field == 1 && wire == 2:
			name = strings.TrimSpace(string(value))
		case field == 2 && wire == 2:
			entry, ok, err := parseSimulationGeoSiteDomain(value)
			if err != nil {
				return err
			}
			if ok {
				entries = append(entries, entry)
			}
		}
		return nil
	})
	return name, entries, err
}

func parseSimulationGeoSiteDomain(raw []byte) (simulationGeoSiteDomain, bool, error) {
	entry := simulationGeoSiteDomain{}
	err := scanProtoFieldValues(raw, func(field, wire int, number uint64, value []byte) error {
		switch {
		case field == 1 && wire == 0:
			entry.kind = number
		case field == 2 && wire == 2:
			entry.value = strings.TrimSpace(string(value))
		}
		return nil
	})
	return entry, entry.value != "", err
}

func (data *simulationLocalData) remoteRuleMatches(rule model.RecognitionRule, target, targetType string, address netip.Addr) (matched, evaluable bool, condition, limitation string) {
	cachePath := filepath.Join(data.dataDir, "ruleset", "recognition-"+strconv.FormatInt(rule.ID, 10)+".yaml")
	content, err := os.ReadFile(cachePath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, false, "", fmt.Sprintf("规则「%s」的 YAML 规则源尚未下载到本机，无法离线模拟", rule.Name)
		}
		return false, false, "", fmt.Sprintf("无法读取规则「%s」的本地 YAML 缓存：%s", rule.Name, err)
	}
	var doc struct {
		Payload []any `yaml:"payload"`
	}
	if err := yaml.Unmarshal(content, &doc); err != nil {
		return false, false, "", fmt.Sprintf("规则「%s」的本地 YAML 缓存格式异常：%s", rule.Name, err)
	}
	if len(doc.Payload) == 0 {
		return false, false, "", fmt.Sprintf("规则「%s」的本地 YAML 缓存没有可用 payload", rule.Name)
	}

	unsupported := ""
	for _, item := range doc.Payload {
		value, ok := item.(string)
		if !ok {
			unsupported = fmt.Sprintf("规则「%s」的本地 YAML 缓存包含无法识别的条目", rule.Name)
			continue
		}
		matched, evaluable, condition, limitation := simulationProviderPayloadMatches(data, rule, value, target, targetType, address)
		if matched {
			return true, true, condition, ""
		}
		if !evaluable && unsupported == "" {
			unsupported = limitation
		}
	}
	if unsupported != "" {
		return false, false, "", unsupported
	}
	return false, true, "", ""
}

func simulationProviderPayloadMatches(data *simulationLocalData, source model.RecognitionRule, rawValue, target, targetType string, address netip.Addr) (matched, evaluable bool, condition, limitation string) {
	value := strings.TrimSpace(rawValue)
	if value == "" {
		return false, true, "", ""
	}
	behavior := strings.ToLower(strings.TrimSpace(source.SourceBehavior))
	switch behavior {
	case "domain":
		if strings.Contains(value, ",") {
			return simulationClassicalPayloadMatches(data, source, value, target, targetType, address)
		}
		kind := "DOMAIN"
		if strings.HasPrefix(value, "+.") || strings.HasPrefix(value, ".") {
			kind = "DOMAIN-SUFFIX"
			value = strings.TrimLeft(value, "+.")
		}
		return simulationRuleMatches(data, model.RecognitionRule{Name: source.Name, Kind: kind, Conditions: []string{value}}, target, targetType, address)
	case "ipcidr":
		if strings.Contains(value, ",") {
			return simulationClassicalPayloadMatches(data, source, value, target, targetType, address)
		}
		return simulationRuleMatches(data, model.RecognitionRule{Name: source.Name, Kind: "IP-CIDR", Conditions: []string{value}}, target, targetType, address)
	case "classical":
		return simulationClassicalPayloadMatches(data, source, value, target, targetType, address)
	default:
		return false, false, "", fmt.Sprintf("规则「%s」的 YAML 匹配类型无效", source.Name)
	}
}

func simulationClassicalPayloadMatches(data *simulationLocalData, source model.RecognitionRule, value, target, targetType string, address netip.Addr) (matched, evaluable bool, condition, limitation string) {
	parts := strings.Split(value, ",")
	if len(parts) < 2 {
		return false, false, "", fmt.Sprintf("规则「%s」的本地 YAML 条目「%s」缺少匹配条件", source.Name, value)
	}
	kind := strings.ToUpper(strings.TrimSpace(parts[0]))
	if kind == "MATCH" {
		return true, true, "MATCH", ""
	}
	return simulationRuleMatches(data, model.RecognitionRule{Name: source.Name, Kind: kind, Conditions: []string{strings.TrimSpace(parts[1])}}, target, targetType, address)
}

// scanProtoFieldValues 是 Geo .dat 解析所需的最小 protobuf 扫描器。它与 Geo 状态
// 统计共用同一线格式，只额外暴露 varint 值以读取 CIDR 前缀和域名匹配类型。
func scanProtoFieldValues(raw []byte, visit func(field, wire int, number uint64, value []byte) error) error {
	for offset := 0; offset < len(raw); {
		tag, n, err := readProtoVarint(raw[offset:])
		if err != nil {
			return err
		}
		offset += n
		field, wire := int(tag>>3), int(tag&7)
		if field == 0 {
			return fmt.Errorf("字段编号无效")
		}
		switch wire {
		case 0:
			number, n, err := readProtoVarint(raw[offset:])
			if err != nil {
				return err
			}
			offset += n
			if err := visit(field, wire, number, nil); err != nil {
				return err
			}
		case 1:
			if len(raw)-offset < 8 {
				return fmt.Errorf("fixed64 字段截断")
			}
			offset += 8
			if err := visit(field, wire, 0, nil); err != nil {
				return err
			}
		case 2:
			length, n, err := readProtoVarint(raw[offset:])
			if err != nil {
				return err
			}
			offset += n
			if length > uint64(len(raw)-offset) {
				return fmt.Errorf("长度字段截断")
			}
			end := offset + int(length)
			if err := visit(field, wire, 0, raw[offset:end]); err != nil {
				return err
			}
			offset = end
		case 5:
			if len(raw)-offset < 4 {
				return fmt.Errorf("fixed32 字段截断")
			}
			offset += 4
			if err := visit(field, wire, 0, nil); err != nil {
				return err
			}
		default:
			return fmt.Errorf("不支持的 wire type %d", wire)
		}
	}
	return nil
}
