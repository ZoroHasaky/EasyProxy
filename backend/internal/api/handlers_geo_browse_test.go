package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"easyproxy/internal/store"
)

func TestGeoDataBrowseHandlers(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	geoSite := apiGeoCategory("github", apiGeoSiteEntry(2, "github.com"), apiGeoSiteEntry(3, "api.github.com"))
	if err := os.WriteFile(filepath.Join(dir, "GeoSite.dat"), geoSite, 0o644); err != nil {
		t.Fatal(err)
	}
	srv := New(st, dir, "test")

	req := httptest.NewRequest(http.MethodGet, "/api/geo/categories?key=geosite&q=git", nil)
	rec := httptest.NewRecorder()
	srv.handleGeoDataCategories(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("categories status=%d body=%s", rec.Code, rec.Body.String())
	}
	var categories struct {
		Total      int `json:"total"`
		Categories []struct {
			Name       string `json:"name"`
			EntryCount int    `json:"entry_count"`
		} `json:"categories"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &categories); err != nil {
		t.Fatal(err)
	}
	if categories.Total != 1 || len(categories.Categories) != 1 || categories.Categories[0].Name != "github" || categories.Categories[0].EntryCount != 2 {
		t.Fatalf("categories=%#v", categories)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/geo/entries?key=geosite&category=github&q=api&page=1&page_size=1", nil)
	rec = httptest.NewRecorder()
	srv.handleGeoDataEntries(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("entries status=%d body=%s", rec.Code, rec.Body.String())
	}
	var entries struct {
		Total   int  `json:"total"`
		HasMore bool `json:"has_more"`
		Entries []struct {
			Value     string `json:"value"`
			EntryType string `json:"entry_type"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &entries); err != nil {
		t.Fatal(err)
	}
	if entries.Total != 1 || entries.HasMore || len(entries.Entries) != 1 || entries.Entries[0].Value != "api.github.com" || entries.Entries[0].EntryType != "full" {
		t.Fatalf("entries=%#v", entries)
	}
}

func TestCreateGeoRecognitionRuleFromGeoIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := os.WriteFile(filepath.Join(dir, "GeoIP.dat"), apiGeoCategory("CN", apiGeoIPEntry([]byte{1, 2, 3, 0}, 24)), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := New(st, dir, "test")
	create := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/recognition-rules/from-geo", bytes.NewBufferString(`{"kind":"GEOIP","condition":"cn"}`))
		rec := httptest.NewRecorder()
		srv.handleCreateGeoRecognitionRule(rec, req)
		return rec
	}

	rec := create()
	if rec.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	var first struct {
		Created bool `json:"created"`
		Rule    struct {
			Kind       string   `json:"kind"`
			Name       string   `json:"name"`
			Conditions []string `json:"conditions"`
		} `json:"rule"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if !first.Created || first.Rule.Kind != "GEOIP" || first.Rule.Name != "Geo · CN" || len(first.Rule.Conditions) != 1 || first.Rule.Conditions[0] != "CN" {
		t.Fatalf("first=%#v", first)
	}

	rec = create()
	if rec.Code != http.StatusOK {
		t.Fatalf("duplicate status=%d body=%s", rec.Code, rec.Body.String())
	}
	var duplicate struct {
		Created bool `json:"created"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &duplicate); err != nil {
		t.Fatal(err)
	}
	if duplicate.Created {
		t.Fatal("duplicate request created another rule")
	}
	rules, err := st.ListRecognitionRules()
	if err != nil {
		t.Fatal(err)
	}
	if len(rules) != 1 {
		t.Fatalf("rules=%#v", rules)
	}
}

func apiGeoCategory(name string, entries ...[]byte) []byte {
	body := apiProtoBytes(1, []byte(name))
	for _, entry := range entries {
		body = append(body, apiProtoBytes(2, entry)...)
	}
	return apiProtoBytes(1, body)
}

func apiGeoIPEntry(ip []byte, prefix uint64) []byte {
	body := apiProtoBytes(1, ip)
	body = append(body, apiProtoVarint(2, prefix)...)
	return body
}

func apiGeoSiteEntry(entryType uint64, value string) []byte {
	body := apiProtoVarint(1, entryType)
	body = append(body, apiProtoBytes(2, []byte(value))...)
	return body
}

func apiProtoBytes(field int, value []byte) []byte {
	return append(append([]byte{byte(field<<3 | 2)}, byte(len(value))), value...)
}

func apiProtoVarint(field int, value uint64) []byte {
	out := []byte{byte(field << 3)}
	for value >= 0x80 {
		out = append(out, byte(value&0x7f)|0x80)
		value >>= 7
	}
	return append(out, byte(value))
}
