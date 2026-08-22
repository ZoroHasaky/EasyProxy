package parser

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// ParseSubscriptionContent 自动识别订阅内容格式：
// 1) Clash/mihomo YAML（含 proxies 列表）
// 2) Base64（解码后为分享链接列表）
// 3) 明文分享链接列表
func ParseSubscriptionContent(content string) ([]map[string]any, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("订阅内容为空")
	}

	// 1) Clash YAML
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(content), &doc); err == nil {
		if raw, ok := doc["proxies"]; ok {
			if list, ok := raw.([]any); ok {
				out := make([]map[string]any, 0, len(list))
				for _, it := range list {
					if mm, ok := it.(map[string]any); ok {
						if t := str(mm["type"]); t != "" && str(mm["server"]) != "" {
							if str(mm["name"]) == "" {
								mm["name"] = str(mm["server"])
							}
							out = append(out, mm)
						}
					}
				}
				if len(out) > 0 {
					return out, nil
				}
			}
		}
	}

	// 2) Base64（去空白后解码）
	compact := strings.Map(func(r rune) rune {
		if r == ' ' || r == '\n' || r == '\r' || r == '\t' {
			return -1
		}
		return r
	}, content)
	if dec, err := b64decode(compact); err == nil {
		s := string(dec)
		if strings.Contains(s, "://") {
			proxies, errs := ParseShareLinks(s)
			if len(proxies) > 0 {
				return proxies, nil
			}
			if len(errs) > 0 {
				return nil, fmt.Errorf("Base64 订阅解析失败：%s", errs[0])
			}
		}
	}

	// 3) 明文链接列表
	if strings.Contains(content, "://") {
		proxies, errs := ParseShareLinks(content)
		if len(proxies) > 0 {
			return proxies, nil
		}
		if len(errs) > 0 {
			return nil, fmt.Errorf("订阅解析失败：%s", errs[0])
		}
	}

	return nil, fmt.Errorf("无法识别的订阅格式（支持 Clash YAML / Base64 / 分享链接列表）")
}
