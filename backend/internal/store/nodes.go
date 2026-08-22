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

// SyncSubscriptionNodes 增量同步某订阅的节点集：按 dedup_hash 匹配保留启停/测速状态
func (s *Store) SyncSubscriptionNodes(sourceID int64, incoming []model.Node) (added, removed int, err error) {
	existing := map[string]model.Node{}
	rows, err := s.db.Query(`SELECT `+nodeCols+` FROM nodes WHERE source_type='sub' AND source_id=?`, sourceID)
	if err != nil {
		return 0, 0, err
	}
	for rows.Next() {
		n, err := scanNode(rows.Scan)
		if err != nil {
			rows.Close()
			return 0, 0, err
		}
		existing[n.DedupHash] = *n
	}
	rows.Close()

	seen := map[string]bool{}
	for i := range incoming {
		in := &incoming[i]
		seen[in.DedupHash] = true
		if old, ok := existing[in.DedupHash]; ok {
			// 保留用户设置，只更新内容与地区
			in.ID = old.ID
			in.Enabled = old.Enabled
			in.Latency = old.Latency
			in.LatencyAt = old.LatencyAt
			in.Alive = old.Alive
			raw, _ := json.Marshal(in.RawConfig)
			_, err := s.db.Exec(`UPDATE nodes SET name=?,type=?,server=?,port=?,region=?,raw_config=?
				WHERE id=?`, in.Name, in.Type, in.Server, in.Port, in.Region, string(raw), in.ID)
			if err != nil {
				return added, removed, err
			}
			continue
		}
		if exists, _ := s.NodeNameExists(in.Name, 0); exists {
			in.Name = s.UniqueNodeName(in.Name)
			in.RawConfig["name"] = in.Name
		}
		if err := s.CreateNode(in); err != nil {
			return added, removed, err
		}
		added++
	}
	for hash, old := range existing {
		if !seen[hash] {
			if _, err := s.db.Exec(`DELETE FROM nodes WHERE id=?`, old.ID); err != nil {
				return added, removed, err
			}
			removed++
		}
	}
	return added, removed, nil
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
