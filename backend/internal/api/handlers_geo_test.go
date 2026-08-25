package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"easyproxy/internal/store"
)

func TestGeoDataStatusHandlerReportsLocalDatabase(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	// 一条 GeoIP 分类，其中包含一条 CIDR 记录。
	if err := os.WriteFile(filepath.Join(dir, "geoip.dat"), []byte{0x0a, 0x02, 0x12, 0x00}, 0o644); err != nil {
		t.Fatal(err)
	}

	srv := New(st, dir, "test")
	req := httptest.NewRequest(http.MethodGet, "/api/geo/status", nil)
	rec := httptest.NewRecorder()
	srv.handleGeoDataStatus(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var result struct {
		Items []struct {
			Key        string `json:"key"`
			State      string `json:"state"`
			GroupCount int    `json:"group_count"`
			EntryCount int    `json:"entry_count"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 2 || result.Items[0].Key != "geoip" || result.Items[0].State != "ready" || result.Items[0].GroupCount != 1 || result.Items[0].EntryCount != 1 {
		t.Fatalf("unexpected status: %#v", result.Items)
	}
}

func TestValidateGeoxURLs(t *testing.T) {
	valid, err := validateGeoxURLs(map[string][]string{"geoip": {" https://example.com/geoip.dat "}})
	if err != nil || valid["geoip"][0] != "https://example.com/geoip.dat" {
		t.Fatalf("valid urls = %#v, err = %v", valid, err)
	}
	if _, err := validateGeoxURLs(map[string][]string{"geoip": {"file:///tmp/geoip.dat"}}); err == nil {
		t.Fatal("expected invalid URL error")
	}
}

func TestRefreshGeoDataRequiresEnabledRunningCore(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")

	req := httptest.NewRequest(http.MethodPost, "/api/geo/refresh", nil)
	rec := httptest.NewRecorder()
	srv.handleRefreshGeoData(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("stopped core status=%d body=%s", rec.Code, rec.Body.String())
	}

	if err := st.SetSetting("geo_enabled", "0"); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	srv.handleRefreshGeoData(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("disabled geo status=%d body=%s", rec.Code, rec.Body.String())
	}
}
