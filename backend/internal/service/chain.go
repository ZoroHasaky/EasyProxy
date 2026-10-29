package service

import (
	"fmt"
	"strings"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

// ChainPlan 描述当前节点池与策略组能够组成的链式代理。
//
// Mihomo 的 relay 策略组已弃用，官方推荐在节点上使用 dialer-proxy：
// 落地节点 B 写入 dialer-proxy: A 后，实际路径为 客户端 → A → B → 目标。
// dialer-proxy 是 proxies 条目的全局字段，同一节点若同时被链式组和普通组
// 引用，直接改原节点会污染普通组，因此这里为链式组生成独立的克隆条目。
type ChainPlan struct {
	// UpstreamByGroup 记录可生成的链式组及其第一跳代理名。
	UpstreamByGroup map[int64]string
	// MembersByGroup 记录链式组的成员（克隆节点名），按组 ID 索引。
	MembersByGroup map[int64][]string
	// Clones 是按顺序写入 proxies 段的克隆节点定义。
	Clones []map[string]any
	// CloneUpstream 记录克隆节点名到第一跳代理名的映射，供链路展示使用。
	CloneUpstream map[string]string
	// Unavailable 记录链式组无法生成的原因，供界面提示与出站回退判断。
	Unavailable map[int64]string
}

// BuildChainPlan 依据当前有效节点与策略组计算链式代理。
// 只支持两跳：第一跳可以是单个节点，也可以是一个未启用链式的既有组合。
// 任何一环失效都不会生成该组，相关规则由解析器回退到 PROXY，
// 与「组合不可用则回退主代理出口」的既有行为一致。
func BuildChainPlan(nodes []model.Node, groups []model.Group) ChainPlan {
	plan := ChainPlan{
		UpstreamByGroup: map[int64]string{},
		MembersByGroup:  map[int64][]string{},
		CloneUpstream:   map[string]string{},
		Unavailable:     map[int64]string{},
	}
	if len(groups) == 0 {
		return plan
	}

	nodeByName := make(map[string]model.Node, len(nodes))
	usedNames := make(map[string]bool, len(nodes)+len(groups))
	for _, n := range nodes {
		nodeByName[n.Name] = n
		usedNames[n.Name] = true
	}
	groupsByID := make(map[int64]model.Group, len(groups))
	for _, g := range groups {
		groupsByID[g.ID] = g
		usedNames[g.Name] = true
	}

	for _, g := range groups {
		raw := strings.TrimSpace(g.ChainUpstream)
		if raw == "" || !g.Enabled {
			continue
		}
		upstreamName, upstreamMembers, reason := resolveChainUpstream(g, raw, nodeByName, groupsByID, nodes)
		if reason != "" {
			plan.Unavailable[g.ID] = reason
			continue
		}

		landing := groupMembers(g, nodes)
		if len(landing) == 0 {
			plan.Unavailable[g.ID] = "节点组合没有可用节点"
			continue
		}

		cloneNames := make([]string, 0, len(landing))
		clones := make([]map[string]any, 0, len(landing))
		for _, name := range landing {
			// 落地节点若同时是第一跳，会形成同一台服务器的自环，跳过。
			if upstreamMembers[name] {
				continue
			}
			node, exists := nodeByName[name]
			if !exists {
				continue
			}
			cloneName := uniqueCloneName(g.Name+" · "+name, usedNames)
			rawConfig := make(map[string]any, len(node.RawConfig)+2)
			for k, v := range node.RawConfig {
				rawConfig[k] = v
			}
			rawConfig["name"] = cloneName
			rawConfig["dialer-proxy"] = upstreamName
			clones = append(clones, rawConfig)
			cloneNames = append(cloneNames, cloneName)
		}
		if len(cloneNames) == 0 {
			plan.Unavailable[g.ID] = "落地节点与前置重合，无法组成链路"
			continue
		}

		plan.UpstreamByGroup[g.ID] = upstreamName
		plan.MembersByGroup[g.ID] = cloneNames
		plan.Clones = append(plan.Clones, clones...)
		for _, name := range cloneNames {
			plan.CloneUpstream[name] = upstreamName
		}
	}
	return plan
}

// resolveChainUpstream 解析并校验第一跳，返回可用的代理名与需要排除的同源节点集合。
func resolveChainUpstream(g model.Group, raw string, nodeByName map[string]model.Node, groupsByID map[int64]model.Group, nodes []model.Node) (string, map[string]bool, string) {
	kind, value, id, ok := model.ParseChainUpstream(raw)
	if !ok {
		return "", nil, "链式前置格式无效"
	}
	switch kind {
	case "node":
		node, exists := nodeByName[value]
		if !exists {
			return "", nil, fmt.Sprintf("链式前置节点「%s」不存在或未启用", value)
		}
		return node.Name, map[string]bool{node.Name: true}, ""
	case "group":
		upstream, exists := groupsByID[id]
		if !exists {
			return "", nil, "链式前置节点组合不存在"
		}
		if upstream.ID == g.ID {
			return "", nil, "链式前置不能是自身"
		}
		if strings.TrimSpace(upstream.ChainUpstream) != "" {
			return "", nil, fmt.Sprintf("链式前置组合「%s」自身已启用链式，仅支持两跳", upstream.Name)
		}
		if !upstream.Enabled {
			return "", nil, fmt.Sprintf("链式前置组合「%s」未启用", upstream.Name)
		}
		members := groupMembers(upstream, nodes)
		if len(members) == 0 {
			return "", nil, fmt.Sprintf("链式前置组合「%s」没有可用节点", upstream.Name)
		}
		seen := make(map[string]bool, len(members))
		for _, name := range members {
			seen[name] = true
		}
		return upstream.Name, seen, ""
	}
	return "", nil, "链式前置格式无效"
}

func uniqueCloneName(base string, used map[string]bool) string {
	name := base
	for i := 2; used[name]; i++ {
		name = fmt.Sprintf("%s #%d", base, i)
	}
	used[name] = true
	return name
}

// ChainCloneUpstreams 返回当前克隆节点到第一跳的映射，供模拟链路展开使用。
func ChainCloneUpstreams(st *store.Store) (map[string]string, error) {
	nodes, err := EffectiveNodes(st)
	if err != nil {
		return nil, err
	}
	groups, err := st.ListGroups()
	if err != nil {
		return nil, err
	}
	plan := BuildChainPlan(nodes, groups)
	return plan.CloneUpstream, nil
}
