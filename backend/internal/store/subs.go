package store

import (
	"time"

	"easyproxy/internal/model"
)

func (s *Store) ListSubscriptions() ([]model.Subscription, error) {
	rows, err := s.db.Query(`SELECT id,name,url,user_agent,update_interval,via_proxy,enabled,
		COALESCE(last_update,''),node_count,COALESCE(user_info,''),COALESCE(created_at,'')
		FROM subscriptions ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Subscription{}
	for rows.Next() {
		var sub model.Subscription
		var lastUp, created string
		if err := rows.Scan(&sub.ID, &sub.Name, &sub.URL, &sub.UserAgent, &sub.UpdateInterval,
			&sub.ViaProxy, &sub.Enabled, &lastUp, &sub.NodeCount, &sub.UserInfo, &created); err != nil {
			return nil, err
		}
		sub.LastUpdate = parseTime(lastUp)
		sub.CreatedAt = parseTime(created)
		out = append(out, sub)
	}
	return out, nil
}

func (s *Store) GetSubscription(id int64) (*model.Subscription, error) {
	var sub model.Subscription
	var lastUp, created string
	err := s.db.QueryRow(`SELECT id,name,url,user_agent,update_interval,via_proxy,enabled,
		COALESCE(last_update,''),node_count,COALESCE(user_info,''),COALESCE(created_at,'')
		FROM subscriptions WHERE id=?`, id).
		Scan(&sub.ID, &sub.Name, &sub.URL, &sub.UserAgent, &sub.UpdateInterval,
			&sub.ViaProxy, &sub.Enabled, &lastUp, &sub.NodeCount, &sub.UserInfo, &created)
	if err != nil {
		return nil, err
	}
	sub.LastUpdate = parseTime(lastUp)
	sub.CreatedAt = parseTime(created)
	return &sub, nil
}

func (s *Store) CreateSubscription(sub *model.Subscription) error {
	now := time.Now().Format(time.RFC3339)
	res, err := s.db.Exec(`INSERT INTO subscriptions(name,url,user_agent,update_interval,via_proxy,enabled,created_at)
		VALUES(?,?,?,?,?,?,?)`,
		sub.Name, sub.URL, sub.UserAgent, sub.UpdateInterval, sub.ViaProxy, sub.Enabled, now)
	if err != nil {
		return err
	}
	sub.ID, _ = res.LastInsertId()
	sub.CreatedAt = time.Now()
	return nil
}

func (s *Store) UpdateSubscription(sub *model.Subscription) error {
	_, err := s.db.Exec(`UPDATE subscriptions SET name=?,url=?,user_agent=?,update_interval=?,via_proxy=?,enabled=?
		WHERE id=?`, sub.Name, sub.URL, sub.UserAgent, sub.UpdateInterval, sub.ViaProxy, sub.Enabled, sub.ID)
	return err
}

func (s *Store) DeleteSubscription(id int64) error {
	if _, err := s.db.Exec(`DELETE FROM nodes WHERE source_type='sub' AND source_id=?`, id); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM subscriptions WHERE id=?`, id)
	return err
}

func (s *Store) TouchSubscription(id int64, nodeCount int, userInfo string) error {
	_, err := s.db.Exec(`UPDATE subscriptions SET last_update=?, node_count=?, user_info=? WHERE id=?`,
		time.Now().Format(time.RFC3339), nodeCount, userInfo, id)
	return err
}

func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339, s)
	return t
}
