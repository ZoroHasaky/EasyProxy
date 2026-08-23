package store

import (
	"fmt"
	"strings"
	"time"

	"easyproxy/internal/model"
)

func (s *Store) ListGroups() ([]model.Group, error) {
	rows, err := s.db.Query(`SELECT id,name,type,region,include_regex,test_url,interval,tolerance,icon,position,enabled
		FROM proxy_groups ORDER BY position,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Group{}
	for rows.Next() {
		var g model.Group
		if err := rows.Scan(&g.ID, &g.Name, &g.Type, &g.Region, &g.IncludeRegex, &g.TestURL,
			&g.Interval, &g.Tolerance, &g.Icon, &g.Position, &g.Enabled); err != nil {
			return nil, err
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
	for i := range groups {
		g := groups[i]
		if existing[g.ID] {
			if _, err := tx.Exec(`UPDATE proxy_groups SET name=?,type=?,region=?,include_regex=?,test_url=?,interval=?,tolerance=?,icon=?,position=?,enabled=? WHERE id=?`,
				g.Name, g.Type, g.Region, g.IncludeRegex, g.TestURL, g.Interval, g.Tolerance, g.Icon, i, g.Enabled, g.ID); err != nil {
				return err
			}
			kept[g.ID] = true
			continue
		}
		res, err := tx.Exec(`INSERT INTO proxy_groups(name,type,region,include_regex,test_url,interval,tolerance,icon,position,enabled)
			VALUES(?,?,?,?,?,?,?,?,?,?)`, g.Name, g.Type, g.Region, g.IncludeRegex, g.TestURL,
			g.Interval, g.Tolerance, g.Icon, i, g.Enabled)
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		kept[id] = true
	}
	deleteIDs := make([]string, 0)
	args := make([]any, 0)
	for id := range existing {
		if !kept[id] {
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
