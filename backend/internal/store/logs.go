package store

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"easyproxy/internal/model"
)

const AuditLogRetention = 30 * 24 * time.Hour

func validAuditLogCategory(category string) bool {
	return category == "traffic" || category == "operation" || category == "core"
}

func validAuditLogLevel(level string) bool {
	switch level {
	case "info", "success", "warning", "error":
		return true
	}
	return false
}

// CreateAuditLog 追加一条持久化日志；sourceKey 非空时保证同一来源事件只记录一次。
func (s *Store) CreateAuditLog(entry model.AuditLog, sourceKey string) (bool, error) {
	if !validAuditLogCategory(entry.Category) {
		return false, fmt.Errorf("无效日志分类: %s", entry.Category)
	}
	if entry.Level == "" {
		entry.Level = "info"
	}
	if !validAuditLogLevel(entry.Level) {
		return false, fmt.Errorf("无效日志级别: %s", entry.Level)
	}
	if strings.TrimSpace(entry.Summary) == "" {
		return false, fmt.Errorf("日志摘要不能为空")
	}
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = time.Now().UTC()
	}
	if entry.Details == nil {
		entry.Details = map[string]any{}
	}
	details, err := json.Marshal(entry.Details)
	if err != nil {
		return false, err
	}
	result, err := s.db.Exec(`INSERT OR IGNORE INTO audit_logs(created_at,category,level,event,summary,details,source_key)
		VALUES(?,?,?,?,?,?,?)`,
		entry.CreatedAt.UTC().Format(time.RFC3339Nano), entry.Category, entry.Level, entry.Event,
		strings.TrimSpace(entry.Summary), string(details), sourceKey)
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	return n > 0, err
}

func scanAuditLog(scan func(...any) error) (model.AuditLog, error) {
	var entry model.AuditLog
	var createdAt, details string
	if err := scan(&entry.ID, &createdAt, &entry.Category, &entry.Level, &entry.Event, &entry.Summary, &details); err != nil {
		return entry, err
	}
	entry.CreatedAt = parseTime(createdAt)
	_ = json.Unmarshal([]byte(details), &entry.Details)
	if entry.Details == nil {
		entry.Details = map[string]any{}
	}
	return entry, nil
}

func auditLogQuery(filter model.AuditLogFilter, includeLimit bool) (string, []any) {
	where := []string{"1=1"}
	args := []any{}
	if filter.Category != "" && filter.Category != "all" {
		where = append(where, "category=?")
		args = append(args, filter.Category)
	}
	if filter.Level != "" && filter.Level != "all" {
		where = append(where, "level=?")
		args = append(args, filter.Level)
	}
	if filter.BeforeID > 0 {
		where = append(where, "id<?")
		args = append(args, filter.BeforeID)
	}
	if query := strings.TrimSpace(filter.Query); query != "" {
		where = append(where, "(summary LIKE ? OR details LIKE ? OR event LIKE ?)")
		like := "%" + query + "%"
		args = append(args, like, like, like)
	}
	query := `SELECT id,created_at,category,level,event,summary,details FROM audit_logs WHERE ` + strings.Join(where, " AND ") + " ORDER BY id DESC"
	if includeLimit {
		query += " LIMIT ?"
		args = append(args, filter.Limit)
	}
	return query, args
}

// ListAuditLogs 读取一页最新日志；nextBeforeID 为 0 表示没有更多数据。
func (s *Store) ListAuditLogs(filter model.AuditLogFilter) ([]model.AuditLog, int64, error) {
	if filter.Limit <= 0 {
		filter.Limit = 100
	}
	if filter.Limit > 500 {
		filter.Limit = 500
	}
	pageSize := filter.Limit
	// 多读取一条来准确判断是否还有下一页，避免记录数恰好等于页大小时
	// 前端额外显示一次会加载出空列表的“加载更多”。
	filter.Limit = pageSize + 1
	query, args := auditLogQuery(filter, true)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	entries := make([]model.AuditLog, 0, filter.Limit)
	for rows.Next() {
		entry, err := scanAuditLog(rows.Scan)
		if err != nil {
			return nil, 0, err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if len(entries) > pageSize {
		entries = entries[:pageSize]
		return entries, entries[len(entries)-1].ID, nil
	}
	return entries, 0, nil
}

// VisitAuditLogs 按筛选结果依次访问日志，用于流式导出而不会把全部记录读入内存。
func (s *Store) VisitAuditLogs(filter model.AuditLogFilter, visit func(model.AuditLog) error) error {
	query, args := auditLogQuery(filter, false)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		entry, err := scanAuditLog(rows.Scan)
		if err != nil {
			return err
		}
		if err := visit(entry); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (s *Store) PruneAuditLogs(before time.Time) error {
	_, err := s.db.Exec(`DELETE FROM audit_logs WHERE created_at<?`, before.UTC().Format(time.RFC3339Nano))
	return err
}

// AuditLogCount 仅供测试与健康检查使用。
func (s *Store) AuditLogCount() (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM audit_logs`).Scan(&count)
	return count, err
}
