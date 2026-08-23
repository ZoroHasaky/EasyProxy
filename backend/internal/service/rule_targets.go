package service

import (
	"sort"

	"easyproxy/internal/model"
	"easyproxy/internal/parser"
	"easyproxy/internal/store"
)

func ListRuleTargetOptions(st *store.Store) ([]model.RuleTargetOption, error) {
	nodes, err := EffectiveNodes(st)
	if err != nil {
		return nil, err
	}
	groups, err := st.ListGroups()
	if err != nil {
		return nil, err
	}
	subs, _ := st.ListSubscriptions()
	sourceNames := make(map[int64]string, len(subs))
	for _, sub := range subs {
		sourceNames[sub.ID] = sub.Name
	}

	out := make([]model.RuleTargetOption, 0, len(groups)+len(nodes))
	for _, g := range groups {
		members := groupMembers(g, nodes)
		kind := "group"
		if g.Region != "" {
			kind = "region_group"
		}
		icon := g.Icon
		if icon == "" && g.Region != "" {
			icon = parser.RegionFlag(g.Region)
		}
		out = append(out, model.RuleTargetOption{
			Value: model.GroupTargetRef(g.ID), Kind: kind, Name: g.Name,
			Region: g.Region, RegionName: parser.RegionCN(g.Region), Icon: icon,
			MemberCount: len(members), Available: g.Enabled && len(members) > 0,
		})
	}
	sort.SliceStable(nodes, func(i, j int) bool {
		if nodes[i].Region != nodes[j].Region {
			return nodes[i].Region < nodes[j].Region
		}
		return nodes[i].Name < nodes[j].Name
	})
	for _, n := range nodes {
		sourceName := "手动导入"
		if n.SourceType == "sub" {
			sourceName = sourceNames[n.SourceID]
		}
		out = append(out, model.RuleTargetOption{
			Value: model.NodeTargetRef(n.ID), Kind: "node", Name: n.Name,
			Region: n.Region, RegionName: parser.RegionCN(n.Region), Icon: parser.RegionFlag(n.Region),
			SourceName: sourceName, Available: true, Alive: n.Alive, Latency: n.Latency,
		})
	}
	return out, nil
}
