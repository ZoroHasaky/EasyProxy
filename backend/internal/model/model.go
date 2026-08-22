package model

import "time"

type Subscription struct {
	ID             int64     `json:"id"`
	Name           string    `json:"name"`
	URL            string    `json:"url"`
	UserAgent      string    `json:"user_agent"`
	UpdateInterval int       `json:"update_interval"` // 分钟，0 = 仅手动
	ViaProxy       bool      `json:"via_proxy"`
	Enabled        bool      `json:"enabled"`
	LastUpdate     time.Time `json:"last_update"`
	NodeCount      int       `json:"node_count"`
	UserInfo       string    `json:"user_info"` // subscription-userinfo 头
	CreatedAt      time.Time `json:"created_at"`
}

type Node struct {
	ID         int64          `json:"id"`
	Name       string         `json:"name"`
	Type       string         `json:"type"`
	Server     string         `json:"server"`
	Port       int            `json:"port"`
	Region     string         `json:"region"`
	SourceType string         `json:"source_type"` // sub | manual
	SourceID   int64          `json:"source_id"`
	RawConfig  map[string]any `json:"raw_config"`
	DedupHash  string         `json:"dedup_hash"`
	Enabled    bool           `json:"enabled"`
	Latency    int            `json:"latency"` // 毫秒，0 = 未知
	LatencyAt  time.Time      `json:"latency_at"`
	Alive      bool           `json:"alive"`
	CreatedAt  time.Time      `json:"created_at"`
}

type Template struct {
	ID        int64             `json:"id"`
	Name      string            `json:"name"`
	Source    string            `json:"source"` // url | paste
	URL       string            `json:"url"`
	Content   string            `json:"content"`
	Mapping   map[string]string `json:"mapping"` // 模板目标名 -> 面板策略组名/内置目标
	Active    bool              `json:"active"`
	UpdatedAt time.Time         `json:"updated_at"`
}

type Rule struct {
	ID         int64  `json:"id"`
	TemplateID int64  `json:"template_id"`
	Kind       string `json:"kind"`
	Value      string `json:"value"`
	Target     string `json:"target"`
	NoResolve  bool   `json:"no_resolve"`
	Position   int    `json:"position"`
	Enabled    bool   `json:"enabled"`
}

type RuleProvider struct {
	ID         int64  `json:"id"`
	TemplateID int64  `json:"template_id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	Behavior   string `json:"behavior"`
	Format     string `json:"format"`
	Interval   int    `json:"interval"` // 秒
}

type Group struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Type         string `json:"type"` // select | url-test | fallback | load-balance
	Region       string `json:"region"`
	IncludeRegex string `json:"include_regex"`
	TestURL      string `json:"test_url"`
	Interval     int    `json:"interval"`
	Tolerance    int    `json:"tolerance"`
	Icon         string `json:"icon"`
	Position     int    `json:"position"`
	Enabled      bool   `json:"enabled"`
}

type NodeFilter struct {
	Region   string `json:"region"`
	Source   string `json:"source"` // sub | manual | ""
	SourceID int64  `json:"source_id"`
	Q        string `json:"q"`
	Enabled  string `json:"enabled"` // "" | true | false
}

const (
	BuiltinDirect = "DIRECT"
	BuiltinReject = "REJECT"
)

func IsBuiltinTarget(t string) bool {
	switch t {
	case "DIRECT", "REJECT", "REJECT-DROP", "PASS":
		return true
	}
	return false
}
