package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func newChainTestServer(t *testing.T) *Server {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return New(st, t.TempDir(), "test")
}

func putGroups(t *testing.T, srv *Server, groups []model.Group) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(groups)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/groups", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	srv.handlePutGroups(rec, req)
	return rec
}

func TestPutGroupsValidatesChainUpstream(t *testing.T) {
	srv := newChainTestServer(t)

	// 自引用
	rec := putGroups(t, srv, []model.Group{{
		ID: 1, Name: "自引用", Enabled: true, ChainUpstream: model.GroupChainUpstream(1),
	}})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "自身") {
		t.Fatalf("self reference: status=%d body=%s", rec.Code, rec.Body.String())
	}

	// 前置组合不存在
	rec = putGroups(t, srv, []model.Group{{
		ID: 1, Name: "悬空", Enabled: true, ChainUpstream: model.GroupChainUpstream(99),
	}})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "不存在") {
		t.Fatalf("missing upstream: status=%d body=%s", rec.Code, rec.Body.String())
	}

	// 前置组合自身已链式（三跳）
	rec = putGroups(t, srv, []model.Group{
		{ID: 1, Name: "前置", Enabled: true, ChainUpstream: model.NodeChainUpstream("JP-01")},
		{ID: 2, Name: "落地", Enabled: true, ChainUpstream: model.GroupChainUpstream(1)},
	})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "两跳") {
		t.Fatalf("three hops: status=%d body=%s", rec.Code, rec.Body.String())
	}

	// 非法格式
	rec = putGroups(t, srv, []model.Group{{
		ID: 1, Name: "坏格式", Enabled: true, ChainUpstream: "whatever",
	}})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "格式无效") {
		t.Fatalf("bad format: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestGetGroupsReportsChainError(t *testing.T) {
	srv := newChainTestServer(t)
	// 保存时不做节点存在性校验（允许机场临时改名），但读取时应报告失效原因。
	if err := srv.st.ReplaceGroups([]model.Group{{
		Name: "香港链式", Enabled: true, ChainUpstream: model.NodeChainUpstream("已删除节点"),
	}}); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/groups", nil)
	rec := httptest.NewRecorder()
	srv.handleGetGroups(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var groups []model.Group
	if err := json.Unmarshal(rec.Body.Bytes(), &groups); err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 {
		t.Fatalf("groups = %#v", groups)
	}
	if groups[0].ChainError == "" {
		t.Fatalf("expected chain_error, got %#v", groups[0])
	}
	if !strings.Contains(groups[0].ChainError, "不存在") {
		t.Fatalf("chain_error = %q", groups[0].ChainError)
	}
}

func TestRuleTargetsMarksBrokenChainGroupUnavailable(t *testing.T) {
	srv := newChainTestServer(t)
	node := model.Node{
		Name: "HK-01", Type: "ss", Server: "127.0.0.1", Port: 10001, Region: "HK",
		SourceType: "manual", Enabled: true, DedupHash: "hash-hk",
		RawConfig: map[string]any{"type": "ss", "server": "127.0.0.1", "port": 10001},
	}
	if err := srv.st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	groups, _ := srv.st.ListGroups()
	_ = groups
	if err := srv.st.ReplaceGroups([]model.Group{{
		Name: "香港链式", Type: "select", MemberMode: "manual", NodeIDs: []int64{node.ID},
		Enabled: true, ChainUpstream: model.NodeChainUpstream("不存在的前置"),
	}}); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/rule-targets", nil)
	rec := httptest.NewRecorder()
	srv.handleGetRuleTargets(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var targets []model.RuleTargetOption
	if err := json.Unmarshal(rec.Body.Bytes(), &targets); err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, target := range targets {
		if target.Name != "香港链式" {
			continue
		}
		found = true
		if target.Available {
			t.Fatalf("broken chain group must be unavailable: %#v", target)
		}
		if target.ChainError == "" {
			t.Fatalf("expected chain_error on target: %#v", target)
		}
	}
	if !found {
		t.Fatalf("chain group not present in targets: %#v", targets)
	}
}
