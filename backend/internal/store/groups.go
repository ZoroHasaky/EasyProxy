package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"easyproxy/internal/model"
)

func (s *Store) ListGroups() ([]model.Group, error) {
	rows, err := s.db.Query(`SELECT id,name,type,member_mode,node_ids,region,include_regex,test_url,interval,tolerance,icon,position,enabled,chain_upstream
		FROM proxy_groups ORDER BY position,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Group{}
	for rows.Next() {
		var g model.Group
		var nodeIDs string
		if err := rows.Scan(&g.ID, &g.Name, &g.Type, &g.MemberMode, &nodeIDs, &g.Region, &g.IncludeRegex, &g.TestURL,
			&g.Interval, &g.Tolerance, &g.Icon, &g.Position, &g.Enabled, &g.ChainUpstream); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(nodeIDs), &g.NodeIDs)
		if g.NodeIDs == nil {
			g.NodeIDs = []int64{}
		}
		out = append(out, g)
	}
	return out, nil
}

// ReplaceGroups 保存策略组并保留已有 ID，使规则可以稳定引用策略组。
func (s *Store) ReplaceGroups(groups []model.Group) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT id FROM proxy_groups`)
	if err != nil {
		return err
	}
	existing := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		existing[id] = true
	}
	rows.Close()

	// 先临时改名，允许两个已有分组互换名称而不触发 UNIQUE 冲突。
	migrationToken := time.Now().UnixNano()
	for id := range existing {
		if _, err := tx.Exec(`UPDATE proxy_groups SET name=? WHERE id=?`, fmt.Sprintf("@easyproxy/migrating/%d/%d", migrationToken, id), id); err != nil {
			return err
		}
	}

	kept := map[int64]bool{}
	// 前端新建组合使用负数临时 ID，链式前置可能引用这些临时 ID。
	// 记录临时 ID 到真实 ID 的映射，写入后统一改写引用。
	remapped := map[int64]int64{}
	for i := range groups {
		g := groups[i]
		nodeIDs, err := json.Marshal(uniqueNodeIDs(g.NodeIDs))
		if err != nil {
			return err
		}
		if existing[g.ID] {
			if _, err := tx.Exec(`UPDATE proxy_groups SET name=?,type=?,member_mode=?,node_ids=?,region=?,include_regex=?,test_url=?,interval=?,tolerance=?,icon=?,position=?,enabled=?,chain_upstream=? WHERE id=?`,
				g.Name, g.Type, g.MemberMode, string(nodeIDs), g.Region, g.IncludeRegex, g.TestURL, g.Interval, g.Tolerance, g.Icon, i, g.Enabled, g.ChainUpstream, g.ID); err != nil {
				return err
			}
			kept[g.ID] = true
			continue
		}
		res, err := tx.Exec(`INSERT INTO proxy_groups(name,type,member_mode,node_ids,region,include_regex,test_url,interval,tolerance,icon,position,enabled,chain_upstream)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, g.Name, g.Type, g.MemberMode, string(nodeIDs), g.Region, g.IncludeRegex, g.TestURL,
			g.Interval, g.Tolerance, g.Icon, i, g.Enabled, g.ChainUpstream)
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		kept[id] = true
		if g.ID <= 0 {
			remapped[g.ID] = id
		}
	}
	if err := remapChainUpstreamRefs(tx, remapped); err != nil {
		return err
	}
	deleteIDs := make([]string, 0)
	args := make([]any, 0)
	for id := range existing {
		if !kept[id] {
			var references int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM outbound_rules WHERE group_id=?`, id).Scan(&references); err != nil {
				return err
			}
			if references > 0 {
				return fmt.Errorf("节点组合仍被 %d 条出站映射引用，无法删除", references)
			}
			var portReferences int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM proxy_port_rules WHERE group_id=? OR target=?`, id, model.GroupTargetRef(id)).Scan(&portReferences); err != nil {
				return err
			}
			if portReferences > 0 {
				return fmt.Errorf("节点组合仍被 %d 条端口分流规则引用，无法删除", portReferences)
			}
			var chainReferences int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM proxy_groups WHERE chain_upstream=?`, model.GroupChainUpstream(id)).Scan(&chainReferences); err != nil {
				return err
			}
			if chainReferences > 0 {
				return fmt.Errorf("节点组合仍被 %d 条链式代理引用，无法删除", chainReferences)
			}
			deleteIDs = append(deleteIDs, "?")
			args = append(args, id)
		}
	}
	if len(deleteIDs) > 0 {
		if _, err := tx.Exec(`DELETE FROM proxy_groups WHERE id IN (`+strings.Join(deleteIDs, ",")+`)`, args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// remapChainUpstreamRefs 把新建组合的负数临时 ID 引用改写为落库后的真实 ID。
// 前端批量保存时无法预知真实 ID，若不改写信箱会留下 group:-<临时 ID> 的悬空引用。
func remapChainUpstreamRefs(tx *sql.Tx, remapped map[int64]int64) error {
	for temporary, actual := range remapped {
		if _, err := tx.Exec(`UPDATE proxy_groups SET chain_upstream=? WHERE chain_upstream=?`,
			model.GroupChainUpstream(actual), model.GroupChainUpstream(temporary)); err != nil {
			return err
		}
	}
	return nil
}

// RenameChainUpstreamNode 将引用某节点的链式前置改写到新节点名。
// chain_upstream 以节点名而非 ID 保存，才能在订阅整源替换后继续有效。
func (s *Store) RenameChainUpstreamNode(oldName, newName string) error {
	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)
	if oldName == "" || newName == "" || oldName == newName {
		return nil
	}
	_, err := s.db.Exec(`UPDATE proxy_groups SET chain_upstream=? WHERE chain_upstream=?`,
		model.NodeChainUpstream(newName), model.NodeChainUpstream(oldName))
	return err
}

func uniqueNodeIDs(ids []int64) []int64 {	seen := make(map[int64]bool, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}
