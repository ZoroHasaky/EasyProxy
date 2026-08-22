package store

import (
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

// ReplaceGroups 全量替换策略组（按 name 对齐，规则里的目标引用的是组名）
func (s *Store) ReplaceGroups(groups []model.Group) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM proxy_groups`); err != nil {
		return err
	}
	for i := range groups {
		g := groups[i]
		if _, err := tx.Exec(`INSERT INTO proxy_groups(name,type,region,include_regex,test_url,interval,tolerance,icon,position,enabled)
			VALUES(?,?,?,?,?,?,?,?,?,?)`,
			g.Name, g.Type, g.Region, g.IncludeRegex, g.TestURL, g.Interval, g.Tolerance, g.Icon, i, g.Enabled); err != nil {
			return err
		}
	}
	return tx.Commit()
}
