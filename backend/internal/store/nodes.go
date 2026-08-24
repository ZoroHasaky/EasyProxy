package store

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"easyproxy/internal/model"
)

const nodeCols = `id,name,type,server,port,region,source_type,source_id,raw_config,dedup_hash,
	enabled,latency,COALESCE(latency_at,''),alive,COALESCE(created_at,'')`

func scanNode(scan func(...any) error) (*model.Node, error) {
	var n model.Node
	var raw, latAt, createdAt string
	if err := scan(&n.ID, &n.Name, &n.Type, &n.Server, &n.Port, &n.Region, &n.SourceType, &n.SourceID,
		&raw, &n.DedupHash, &n.Enabled, &n.Latency, &latAt, &n.Alive, &createdAt); err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(raw), &n.RawConfig)
	if n.RawConfig == nil {
		n.RawConfig = map[string]any{}
	}
	n.LatencyAt = parseTime(latAt)
	n.CreatedAt = parseTime(createdAt)
	return &n, nil
}

func (s *Store) ListNodes(f model.NodeFilter) ([]model.Node, error) {
	where := []string{"1=1"}
	args := []any{}
	if f.Region != "" {
		where = append(where, "region=?")
		args = append(args, f.Region)
	}
	if f.Source != "" {
		where = append(where, "source_type=?")
		args = append(args, f.Source)
	}
	if f.SourceID != 0 {
		where = append(where, "source_id=?")
		args = append(args, f.SourceID)
	}
	if f.Enabled == "true" || f.Enabled == "false" {
		where = append(where, "enabled=?")
		args = append(args, f.Enabled == "true")
	}
	if f.Q != "" {
		where = append(where, "(name LIKE ? OR server LIKE ?)")
		q := "%" + f.Q + "%"
		args = append(args, q, q)
	}
	rows, err := s.db.Query(`SELECT `+nodeCols+` FROM nodes WHERE `+strings.Join(where, " AND ")+` ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Node{}
	for rows.Next() {
		n, err := scanNode(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *n)
	}
	return out, nil
}

func (s *Store) ListEnabledNodes() ([]model.Node, error) {
	return s.ListNodes(model.NodeFilter{Enabled: "true"})
}

func (s *Store) GetNode(id int64) (*model.Node, error) {
	row := s.db.QueryRow(`SELECT `+nodeCols+` FROM nodes WHERE id=?`, id)
	return scanNode(row.Scan)
}

func (s *Store) CreateNode(n *model.Node) error {
	raw, _ := json.Marshal(n.RawConfig)
	now := time.Now().Format(time.RFC3339)
	res, err := s.db.Exec(`INSERT INTO nodes(name,type,server,port,region,source_type,source_id,
		raw_config,dedup_hash,enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		n.Name, n.Type, n.Server, n.Port, n.Region, n.SourceType, n.SourceID, string(raw), n.DedupHash, n.Enabled, now)
	if err != nil {
		return err
	}
	n.ID, _ = res.LastInsertId()
	n.CreatedAt = time.Now()
	return nil
}

func (s *Store) UpdateNode(n *model.Node) error {
	raw, _ := json.Marshal(n.RawConfig)
	_, err := s.db.Exec(`UPDATE nodes SET name=?,type=?,server=?,port=?,region=?,raw_config=?,enabled=?
		WHERE id=?`, n.Name, n.Type, n.Server, n.Port, n.Region, string(raw), n.Enabled, n.ID)
	return err
}

func (s *Store) DeleteNode(id int64) error {
	_, err := s.db.Exec(`DELETE FROM nodes WHERE id=?`, id)
	return err
}

func (s *Store) NodeNameExists(name string, excludeID int64) (bool, error) {
	var cnt int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM nodes WHERE name=? AND id!=?`, name, excludeID).Scan(&cnt)
	return cnt > 0, err
}

// UniqueNodeName 保证节点名唯一：重名追加序号
func (s *Store) UniqueNodeName(base string) string {
	name := base
	for i := 2; ; i++ {
		exists, err := s.NodeNameExists(name, 0)
		if err != nil || !exists {
			return name
		}
		name = fmt.Sprintf("%s #%d", base, i)
	}
}

func (s *Store) NodeHashExists(hash string) (bool, error) {
	var cnt int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM nodes WHERE dedup_hash=?`, hash).Scan(&cnt)
	return cnt > 0, err
}

// SyncSubscriptionNodes 原子替换某订阅的全部节点。下载和解析在调用前完成；
// 写入失败时事务回滚，原节点保持不变。
func (s *Store) SyncSubscriptionNodes(sourceID int64, incoming []model.Node) (added, removed int, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()

	if err := tx.QueryRow(`SELECT COUNT(*) FROM nodes WHERE source_type='sub' AND source_id=?`, sourceID).Scan(&removed); err != nil {
		return 0, 0, err
	}
	if _, err := tx.Exec(`DELETE FROM nodes WHERE source_type='sub' AND source_id=?`, sourceID); err != nil {
		return 0, 0, err
	}

	// 节点名在全局唯一；删除旧订阅节点后，以剩余节点名为基准为新节点消歧。
	names := map[string]bool{}
	rows, err := tx.Query(`SELECT name FROM nodes`)
	if err != nil {
		return 0, 0, err
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return 0, 0, err
		}
		names[name] = true
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, 0, err
	}
	rows.Close()

	now := time.Now()
	createdAt := now.Format(time.RFC3339)
	for i := range incoming {
		in := &incoming[i]
		in.SourceType = "sub"
		in.SourceID = sourceID
		in.Enabled = true
		in.Latency = 0
		in.LatencyAt = time.Time{}
		in.Alive = false
		if in.RawConfig == nil {
			in.RawConfig = map[string]any{}
		}
		if names[in.Name] {
			base := in.Name
			for suffix := 2; ; suffix++ {
				candidate := fmt.Sprintf("%s #%d", base, suffix)
				if !names[candidate] {
					in.Name = candidate
					break
				}
			}
			in.RawConfig["name"] = in.Name
		}
		names[in.Name] = true
		raw, err := json.Marshal(in.RawConfig)
		if err != nil {
			return added, removed, err
		}
		res, err := tx.Exec(`INSERT INTO nodes(name,type,server,port,region,source_type,source_id,
			raw_config,dedup_hash,enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
			in.Name, in.Type, in.Server, in.Port, in.Region, in.SourceType, in.SourceID,
			string(raw), in.DedupHash, in.Enabled, createdAt)
		if err != nil {
			return added, removed, err
		}
		in.ID, _ = res.LastInsertId()
		in.CreatedAt = now
		added++
	}
	if err := tx.Commit(); err != nil {
		return added, removed, err
	}
	return added, removed, nil
}

// PruneDeadNodes 删除已测速且失活（超时/不可达）的节点
func (s *Store) PruneDeadNodes() (int64, error) {
	res, err := s.db.Exec(`DELETE FROM nodes WHERE latency_at != '' AND alive=0`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *Store) UpdateNodeLatencies(nameToLatency map[string]int) (int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	n := 0
	now := time.Now().Format(time.RFC3339)
	for name, ms := range nameToLatency {
		if _, err := tx.Exec(`UPDATE nodes SET latency=?, latency_at=?, alive=? WHERE name=?`,
			ms, now, ms > 0, name); err != nil {
			return 0, err
		}
		n++
	}
	return n, tx.Commit()
}
