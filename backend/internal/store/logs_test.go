package store

import (
	"testing"
	"time"

	"easyproxy/internal/model"
)

func TestAuditLogsFilterDeduplicateAndPrune(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	inserted, err := st.CreateAuditLog(model.AuditLog{
		Category: "traffic", Level: "info", Event: "traffic.match", Summary: "访问 example.com",
		Details: map[string]any{"target": "example.com", "chains": []string{"PROXY", "节点 A"}},
	}, "connection:one")
	if err != nil || !inserted {
		t.Fatalf("first insert inserted=%v err=%v", inserted, err)
	}
	inserted, err = st.CreateAuditLog(model.AuditLog{
		Category: "traffic", Level: "info", Event: "traffic.match", Summary: "重复连接",
	}, "connection:one")
	if err != nil || inserted {
		t.Fatalf("duplicate inserted=%v err=%v", inserted, err)
	}
	_, err = st.CreateAuditLog(model.AuditLog{Category: "operation", Level: "success", Event: "node.import", Summary: "节点已导入"}, "")
	if err != nil {
		t.Fatal(err)
	}
	_, err = st.CreateAuditLog(model.AuditLog{
		CreatedAt: time.Now().Add(-31 * 24 * time.Hour), Category: "core", Level: "info", Event: "core.start", Summary: "旧内核日志",
	}, "")
	if err != nil {
		t.Fatal(err)
	}

	traffic, _, err := st.ListAuditLogs(model.AuditLogFilter{Category: "traffic", Query: "example"})
	if err != nil || len(traffic) != 1 || traffic[0].Details["target"] != "example.com" {
		t.Fatalf("traffic filter=%#v err=%v", traffic, err)
	}
	if err := st.PruneAuditLogs(time.Now().Add(-30 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	all, _, err := st.ListAuditLogs(model.AuditLogFilter{Limit: 10})
	if err != nil || len(all) != 2 {
		t.Fatalf("remaining logs=%#v err=%v", all, err)
	}
}

func TestAuditLogsPaginationOnlyReturnsCursorWhenMoreEntriesExist(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	for _, summary := range []string{"第一条", "第二条"} {
		if _, err := st.CreateAuditLog(model.AuditLog{
			Category: "operation", Level: "info", Event: "settings.changed", Summary: summary,
		}, ""); err != nil {
			t.Fatal(err)
		}
	}

	firstPage, nextBefore, err := st.ListAuditLogs(model.AuditLogFilter{Limit: 1})
	if err != nil || len(firstPage) != 1 || nextBefore != firstPage[0].ID {
		t.Fatalf("first page=%#v next=%d err=%v", firstPage, nextBefore, err)
	}
	secondPage, nextBefore, err := st.ListAuditLogs(model.AuditLogFilter{Limit: 1, BeforeID: nextBefore})
	if err != nil || len(secondPage) != 1 || nextBefore != 0 {
		t.Fatalf("second page=%#v next=%d err=%v", secondPage, nextBefore, err)
	}
}
