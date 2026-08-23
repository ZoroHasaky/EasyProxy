package store

import (
	"encoding/json"

	"easyproxy/internal/model"
)

// migrateRuleTargetRefs 将旧版按策略组名称保存的目标转换为稳定的策略组 ID 引用。
// 每次启动执行且幂等，便于兼容旧数据库和旧备份恢复后的数据。
func (s *Store) migrateRuleTargetRefs() error {
	rows, err := s.db.Query(`SELECT id,name FROM proxy_groups`)
	if err != nil {
		return err
	}
	groupRefs := map[string]string{}
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			rows.Close()
			return err
		}
		if name != "" && !model.IsBuiltinTarget(name) {
			groupRefs[name] = model.GroupTargetRef(id)
		}
	}
	rows.Close()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for name, ref := range groupRefs {
		if _, err := tx.Exec(`UPDATE rules SET target=? WHERE target=?`, ref, name); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE rules SET base_target=? WHERE base_target=?`, ref, name); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE rules SET base_target=target WHERE base_target=''`); err != nil {
		return err
	}

	tplRows, err := tx.Query(`SELECT id,mapping FROM templates`)
	if err != nil {
		return err
	}
	type templateMapping struct {
		id      int64
		mapping string
	}
	templates := []templateMapping{}
	for tplRows.Next() {
		var item templateMapping
		if err := tplRows.Scan(&item.id, &item.mapping); err != nil {
			tplRows.Close()
			return err
		}
		templates = append(templates, item)
	}
	tplRows.Close()
	for _, item := range templates {
		mapping := map[string]string{}
		if json.Unmarshal([]byte(item.mapping), &mapping) != nil {
			continue
		}
		changed := false
		for key, target := range mapping {
			if ref, ok := groupRefs[target]; ok {
				mapping[key] = ref
				changed = true
			}
		}
		if !changed {
			continue
		}
		encoded, _ := json.Marshal(mapping)
		if _, err := tx.Exec(`UPDATE templates SET mapping=? WHERE id=?`, string(encoded), item.id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
