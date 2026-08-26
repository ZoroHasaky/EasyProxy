package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easyproxy/internal/core"
	"easyproxy/internal/store"
)

func TestSettingsPutReturnsAndMaintainsPendingConfigChanges(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")

	put := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/api/settings", bytes.NewBufferString(body))
		rec := httptest.NewRecorder()
		srv.handlePutSettings(rec, req)
		return rec
	}
	rec := put(`{"mixed_port":18080,"update_repo":"owner/repo","update_via_proxy":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status=%d body=%s", rec.Code, rec.Body.String())
	}
	var updated struct {
		OK           bool `json:"ok"`
		PendingCount int  `json:"pending_count"`
		Pending      struct {
			Count int `json:"count"`
			Items []struct {
				Scope  string   `json:"scope"`
				Fields []string `json:"fields"`
				Status string   `json:"status"`
			} `json:"items"`
		} `json:"pending"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if !updated.OK || updated.PendingCount != 1 || updated.Pending.Count != 1 || len(updated.Pending.Items) != 1 ||
		updated.Pending.Items[0].Scope != store.ConfigScopeKernelNetwork || len(updated.Pending.Items[0].Fields) != 1 ||
		updated.Pending.Items[0].Fields[0] != "mixed_port" || updated.Pending.Items[0].Status != store.PendingConfigStatusPending {
		t.Fatalf("unexpected PUT response: %s", rec.Body.String())
	}
	if got := st.GetSetting("update_repo", ""); got != "" {
		t.Fatalf("deprecated update repo must not be saved: %q", got)
	}
	if got := st.GetSetting("update_via_proxy", ""); got != "" {
		t.Fatalf("deprecated update proxy setting must not be saved: %q", got)
	}
	if got := srv.updateRepo(); got != DefaultUpdateRepo {
		t.Fatalf("update repo=%q, want fixed %q", got, DefaultUpdateRepo)
	}
	if proxy := srv.updateProxyAddr(); proxy != "" {
		t.Fatalf("panel update must use direct connection, got proxy %q", proxy)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/config/pending", nil)
	rec = httptest.NewRecorder()
	srv.handleGetPendingConfigChanges(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status=%d body=%s", rec.Code, rec.Body.String())
	}
	var listed struct {
		Count int `json:"count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if listed.Count != 1 {
		t.Fatalf("GET pending count=%d body=%s", listed.Count, rec.Body.String())
	}

	rec = put(`{"mixed_port":7890}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("rollback PUT status=%d body=%s", rec.Code, rec.Body.String())
	}
	if changes, err := st.ListPendingConfigChanges(); err != nil || len(changes) != 0 {
		t.Fatalf("rollback should remove pending entry: %#v, %v", changes, err)
	}
}

func TestConfigApplySnapshotsSettingsAndClearsPendingAfterSuccess(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if _, err := st.UpdateConfigSettingsAndSyncPending(map[string]string{"mixed_port": "18080"}); err != nil {
		t.Fatal(err)
	}
	srv := New(st, dir, "test")
	req := httptest.NewRequest(http.MethodPost, "/api/config/apply", nil)
	rec := httptest.NewRecorder()
	srv.handleConfigApply(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("apply status=%d body=%s", rec.Code, rec.Body.String())
	}
	applied, err := st.AppliedConfigSettings()
	if err != nil {
		t.Fatal(err)
	}
	if applied["mixed_port"] != "18080" {
		t.Fatalf("applied mixed port=%q, want 18080", applied["mixed_port"])
	}
	if yaml, err := st.AppliedConfigYAML(); err != nil || !strings.Contains(yaml, "mixed-port: 18080") {
		t.Fatalf("applied YAML did not match successful config: %q, %v", yaml, err)
	}
	if changes, err := st.ListPendingConfigChanges(); err != nil || len(changes) != 0 {
		t.Fatalf("successful apply should clear pending changes: %#v, %v", changes, err)
	}
}

func TestFailedApplyKeepsSnapshotAndRecordsAutomaticRetry(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if _, err := st.UpdateConfigSettingsAndSyncPending(map[string]string{"mixed_port": "18080"}); err != nil {
		t.Fatal(err)
	}
	const stableYAML = "mixed-port: 7890\n# last-known-good\n"
	if err := st.SaveAppliedConfigYAML(stableYAML); err != nil {
		t.Fatal(err)
	}
	corePath := core.CorePath(dir)
	if err := os.MkdirAll(filepath.Dir(corePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(corePath, []byte("not an executable"), 0o755); err != nil {
		t.Fatal(err)
	}
	srv := New(st, dir, "test")

	// 统一应用失败时，旧快照和系统设置的待应用项必须保留。
	req := httptest.NewRequest(http.MethodPost, "/api/config/apply", nil)
	rec := httptest.NewRecorder()
	srv.handleConfigApply(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("failed apply status=%d body=%s", rec.Code, rec.Body.String())
	}
	applied, err := st.AppliedConfigSettings()
	if err != nil {
		t.Fatal(err)
	}
	if applied["mixed_port"] != "7890" {
		t.Fatalf("failed apply changed snapshot to %q", applied["mixed_port"])
	}
	if config, err := os.ReadFile(filepath.Join(dir, "config.yaml")); err != nil || string(config) != stableYAML {
		t.Fatalf("failed apply did not restore last known good YAML: %q, %v", config, err)
	}

	// 节点等自动应用失败不回滚数据，而是写入可重试的失败项。
	if result, applyError := srv.applyChangedConfig("nodes", []string{"节点池"}); result != "" || applyError == "" {
		t.Fatalf("automatic apply result=%q error=%q, want failure", result, applyError)
	}
	changes, err := st.ListPendingConfigChanges()
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]string{}
	for _, change := range changes {
		statuses[change.Scope] = change.Status
	}
	if statuses[store.ConfigScopeKernelNetwork] != store.PendingConfigStatusPending || statuses["nodes"] != store.PendingConfigStatusFailed {
		t.Fatalf("unexpected pending statuses: %#v", statuses)
	}
	if config, err := os.ReadFile(filepath.Join(dir, "config.yaml")); err != nil || string(config) != stableYAML {
		t.Fatalf("failed automatic apply did not restore last known good YAML: %q, %v", config, err)
	}
}

func TestLatencyChecksDoNotApplyPendingSystemConfig(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if _, err := st.UpdateConfigSettingsAndSyncPending(map[string]string{"mixed_port": "18080", "tun_enable": "1"}); err != nil {
		t.Fatal(err)
	}
	srv := New(st, dir, "test")

	batchReq := httptest.NewRequest(http.MethodPost, "/api/nodes/check", bytes.NewBufferString(`{"ids":[]}`))
	batchRec := httptest.NewRecorder()
	srv.handleCheckNodes(batchRec, batchReq)
	if batchRec.Code != http.StatusBadGateway {
		t.Fatalf("batch check status=%d body=%s", batchRec.Code, batchRec.Body.String())
	}

	delayReq := httptest.NewRequest(http.MethodGet, "/api/nodes/999/delay", nil)
	delayReq.SetPathValue("id", "999")
	delayRec := httptest.NewRecorder()
	srv.handleNodeDelay(delayRec, delayReq)
	if delayRec.Code != http.StatusNotFound {
		t.Fatalf("single check status=%d body=%s", delayRec.Code, delayRec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "config.yaml")); !os.IsNotExist(err) {
		t.Fatalf("latency checks unexpectedly generated/applied config: %v", err)
	}
	changes, err := st.ListPendingConfigChanges()
	if err != nil || len(changes) != 2 {
		t.Fatalf("latency checks changed pending settings: %#v, %v", changes, err)
	}
}

func TestMetaIncludesSystemInformation(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, t.TempDir(), "1.2.3")
	req := httptest.NewRequest(http.MethodGet, "/api/meta", nil)
	rec := httptest.NewRecorder()
	srv.handleMeta(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("meta status=%d body=%s", rec.Code, rec.Body.String())
	}
	var meta struct {
		Version string `json:"version"`
		System  struct {
			ReleaseRepo  string `json:"release_repo"`
			Commit       string `json:"commit"`
			BuildType    string `json:"build_type"`
			Architecture string `json:"architecture"`
			GoVersion    string `json:"go_version"`
			Timezone     string `json:"timezone"`
		} `json:"system"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &meta); err != nil {
		t.Fatal(err)
	}
	if meta.Version != "1.2.3" || meta.System.ReleaseRepo != DefaultUpdateRepo || meta.System.BuildType != "正式发布" ||
		meta.System.Architecture == "" || meta.System.GoVersion == "" || meta.System.Timezone == "" {
		t.Fatalf("unexpected meta response: %s", rec.Body.String())
	}
}
