package parser

import "strings"

type RegionDef struct {
	Code     string
	Flag     string
	CN       string
	Keywords []string
}

// Regions 地区识别表；顺序即匹配优先级（短词/易混淆词放前面）
var Regions = []RegionDef{
	{"HK", "🇭🇰", "香港", []string{"香港", "🇭🇰", "深港", "沪港", "HK", "Hong Kong", "HongKong", "Hong-Kong"}},
	{"TW", "🇹🇼", "台湾", []string{"台湾", "臺灣", "台北", "新北", "彰化", "🇹🇼", "TW", "Taiwan", "TWN"}},
	{"JP", "🇯🇵", "日本", []string{"日本", "东京", "東京", "大阪", "埼玉", "🇯🇵", "JP", "Japan", "Tokyo", "Osaka", "JPN"}},
	{"KR", "🇰🇷", "韩国", []string{"韩国", "韓國", "首尔", "春川", "🇰🇷", "KR", "Korea", "Seoul", "KOR"}},
	{"SG", "🇸🇬", "新加坡", []string{"新加坡", "狮城", "🇸🇬", "SG", "Singapore", "SGP"}},
	{"MY", "🇲🇾", "马来西亚", []string{"马来西亚", "馬來西亞", "🇲🇾", "MY", "Malaysia"}},
	{"TH", "🇹🇭", "泰国", []string{"泰国", "泰國", "曼谷", "🇹🇭", "TH", "Thailand"}},
	{"PH", "🇵🇭", "菲律宾", []string{"菲律宾", "🇵🇭", "PH", "Philippines"}},
	{"VN", "🇻🇳", "越南", []string{"越南", "🇻🇳", "VN", "Vietnam"}},
	{"ID", "🇮🇩", "印尼", []string{"印尼", "印度尼西亚", "雅加达", "🇮🇩", "ID", "Indonesia"}},
	{"IN", "🇮🇳", "印度", []string{"印度", "孟买", "🇮🇳", "IN", "India", "Mumbai"}},
	{"TR", "🇹🇷", "土耳其", []string{"土耳其", "伊斯坦布尔", "🇹🇷", "TR", "Turkey", "Istanbul", "Turkiye"}},
	{"RU", "🇷🇺", "俄罗斯", []string{"俄罗斯", "俄羅斯", "莫斯科", "圣彼得堡", "🇷🇺", "RU", "Russia", "Moscow"}},
	{"US", "🇺🇸", "美国", []string{"美国", "美國", "🇺🇸", "US", "United States", "USA", "America", "洛杉矶", "圣何塞", "圣克拉拉", "西雅图", "芝加哥", "达拉斯", "凤凰城", "纽约", "LA", "Los Angeles", "San Jose", "Seattle", "Chicago", "Dallas", "Phoenix", "New York", "SJC", "LAX"}},
	{"CA", "🇨🇦", "加拿大", []string{"加拿大", "🇨🇦", "CA", "Canada", "Toronto"}},
	{"MX", "🇲🇽", "墨西哥", []string{"墨西哥", "🇲🇽", "MX", "Mexico"}},
	{"BR", "🇧🇷", "巴西", []string{"巴西", "🇧🇷", "BR", "Brazil"}},
	{"AR", "🇦🇷", "阿根廷", []string{"阿根廷", "🇦🇷", "AR", "Argentina"}},
	{"GB", "🇬🇧", "英国", []string{"英国", "英國", "伦敦", "🇬🇧", "GB", "UK", "United Kingdom", "Great Britain", "London"}},
	{"DE", "🇩🇪", "德国", []string{"德国", "德國", "法兰克福", "🇩🇪", "DE", "Germany", "Frankfurt"}},
	{"FR", "🇫🇷", "法国", []string{"法国", "法國", "巴黎", "🇫🇷", "FR", "France", "Paris"}},
	{"NL", "🇳🇱", "荷兰", []string{"荷兰", "荷蘭", "阿姆斯特丹", "🇳🇱", "NL", "Netherlands", "Amsterdam"}},
	{"CH", "🇨🇭", "瑞士", []string{"瑞士", "苏黎世", "🇨🇭", "CH", "Switzerland", "Zurich"}},
	{"SE", "🇸🇪", "瑞典", []string{"瑞典", "斯德哥尔摩", "🇸🇪", "SE", "Sweden", "Stockholm"}},
	{"IT", "🇮🇹", "意大利", []string{"意大利", "米兰", "🇮🇹", "IT", "Italy", "Milan"}},
	{"ES", "🇪🇸", "西班牙", []string{"西班牙", "马德里", "🇪🇸", "ES", "Spain", "Madrid"}},
	{"AE", "🇦🇪", "阿联酋", []string{"阿联酋", "迪拜", "🇦🇪", "AE", "Dubai", "UAE"}},
	{"AU", "🇦🇺", "澳大利亚", []string{"澳大利亚", "澳洲", "悉尼", "🇦🇺", "AU", "Australia", "Sydney"}},
	{"NZ", "🇳🇿", "新西兰", []string{"新西兰", "🇳🇿", "NZ", "New Zealand"}},
	{"ZA", "🇿🇦", "南非", []string{"南非", "约翰内斯堡", "🇿🇦", "ZA", "South Africa"}},
}

const RegionOther = "OTHER"

// ParseRegion 从节点名识别地区代码；未识别返回 OTHER
func ParseRegion(name string) string {
	if name == "" {
		return RegionOther
	}
	up := strings.ToUpper(name)
	for _, r := range Regions {
		for _, kw := range r.Keywords {
			if matchKeyword(name, up, kw) {
				return r.Code
			}
		}
	}
	return RegionOther
}

// matchKeyword：中文关键词直接包含；纯拉丁短词按 token 精确匹配（避免 US 误中 RUS）
func matchKeyword(name, upName, kw string) bool {
	if strings.ContainsAny(kw, " ") {
		return strings.Contains(upName, strings.ToUpper(kw))
	}
	isASCII := true
	for _, r := range kw {
		if r > 127 {
			isASCII = false
			break
		}
	}
	if !isASCII {
		return strings.Contains(name, kw)
	}
	kwUp := strings.ToUpper(kw)
	for _, tok := range strings.FieldsFunc(upName, func(r rune) bool {
		return !(r >= '0' && r <= '9' || r >= 'A' && r <= 'Z')
	}) {
		if tok == kwUp {
			return true
		}
	}
	// 旗帜 emoji 等非 ASCII 字符直接包含
	return false
}

func RegionFlag(code string) string {
	for _, r := range Regions {
		if r.Code == code {
			return r.Flag
		}
	}
	if code == RegionOther {
		return "🌐"
	}
	return "🌐"
}

func RegionCN(code string) string {
	for _, r := range Regions {
		if r.Code == code {
			return r.CN
		}
	}
	if code == RegionOther {
		return "其他"
	}
	return code
}
