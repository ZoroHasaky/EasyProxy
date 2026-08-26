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

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func geoProtoField(field int, value []byte) []byte {
	return append([]byte{byte(field<<3 | 2), byte(len(value))}, value...)
}

func geoCategoryFile(categories ...string) []byte {
	var data []byte
	for _, category := range categories {
		entry := append(geoProtoField(1, []byte(category)), geoProtoField(2, nil)...)
		data = append(data, geoProtoField(1, entry)...)
	}
	return data
}

func callGenerateGeoRules(t *testing.T, srv *Server, presetIDs []string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"preset_ids": presetIDs})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/recognition-rules/generate-geo", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	srv.handleGenerateGeoRecognitionRules(rec, req)
	return rec
}

func TestGeoRecognitionPresetsAndGeneration(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := os.WriteFile(filepath.Join(dir, "GeoIP.dat"), geoCategoryFile("PRIVATE", "CN"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "GeoSite.dat"), geoCategoryFile("private", "cn", "google", "github"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := New(st, dir, "test")

	presetReq := httptest.NewRequest(http.MethodGet, "/api/recognition-rules/geo-presets", nil)
	presetRec := httptest.NewRecorder()
	srv.handleGetGeoRecognitionPresets(presetRec, presetReq)
	var catalog geoRecognitionPresetCatalog
	if err := json.Unmarshal(presetRec.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if !catalog.Available || len(catalog.Presets) != len(geoRecognitionPresetDefinitions) {
		t.Fatalf("catalog = %#v", catalog)
	}
	available := map[string]geoRecognitionPreset{}
	for _, preset := range catalog.Presets {
		available[preset.ID] = preset
	}
	if !available["private-ip"].Available || available["private-ip"].Condition != "PRIVATE" || !available["github"].Available || available["ads"].Available {
		t.Fatalf("preset availability = %#v", available)
	}

	generated := callGenerateGeoRules(t, srv, []string{"private-ip", "cn-ip", "github", "ads"})
	if generated.Code != http.StatusConflict {
		t.Fatalf("unavailable preset status=%d body=%s", generated.Code, generated.Body.String())
	}
	generated = callGenerateGeoRules(t, srv, []string{"private-ip", "cn-ip", "github"})
	if generated.Code != http.StatusOK {
		t.Fatalf("generate status=%d body=%s", generated.Code, generated.Body.String())
	}
	var result struct {
		Count   int                     `json:"count"`
		Created []model.RecognitionRule `json:"created"`
	}
	if err := json.Unmarshal(generated.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Count != 3 || len(result.Created) != 3 {
		t.Fatalf("generate result = %#v", result)
	}
	for _, rule := range result.Created {
		if !rule.Enabled || rule.Priority != 1 || len(rule.Conditions) != 1 || !strings.HasPrefix(rule.Name, "Geo · ") {
			t.Fatalf("generated rule = %#v", rule)
		}
	}
	outbounds, err := st.ListOutboundRules()
	if err != nil || len(outbounds) != 0 {
		t.Fatalf("outbounds = %#v err=%v", outbounds, err)
	}

	duplicate := callGenerateGeoRules(t, srv, []string{"private-ip", "cn-ip", "github"})
	if duplicate.Code != http.StatusOK {
		t.Fatalf("duplicate status=%d body=%s", duplicate.Code, duplicate.Body.String())
	}
	var duplicateResult struct {
		Count       int                            `json:"count"`
		Skipped     []geoRecognitionGenerationSkip `json:"skipped"`
		ApplyResult string                         `json:"apply_result"`
	}
	if err := json.Unmarshal(duplicate.Body.Bytes(), &duplicateResult); err != nil {
		t.Fatal(err)
	}
	if duplicateResult.Count != 0 || len(duplicateResult.Skipped) != 3 || duplicateResult.ApplyResult != "" {
		t.Fatalf("duplicate result = %#v", duplicateResult)
	}
}

func TestGeoRecognitionPresetsRequireDownloadedData(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	srv := New(st, dir, "test")

	catalog := srv.geoRecognitionPresets()
	if catalog.Available || catalog.Message == "" {
		t.Fatalf("catalog without data = %#v", catalog)
	}
	result := callGenerateGeoRules(t, srv, []string{"github"})
	if result.Code != http.StatusConflict {
		t.Fatalf("generation without data status=%d body=%s", result.Code, result.Body.String())
	}
}

func TestGeoRecognitionGenerationSkipsNameConflictsAndRequiresLogin(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := os.WriteFile(filepath.Join(dir, "GeoSite.dat"), geoCategoryFile("apple"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateRecognitionRules([]model.RecognitionRule{{
		Name: "Geo · Apple 服务", Kind: "GEOSITE", Conditions: []string{"different"}, Priority: 5, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	srv := New(st, dir, "test")

	conflict := callGenerateGeoRules(t, srv, []string{"apple"})
	if conflict.Code != http.StatusOK {
		t.Fatalf("name conflict status=%d body=%s", conflict.Code, conflict.Body.String())
	}
	var result struct {
		Count   int                            `json:"count"`
		Skipped []geoRecognitionGenerationSkip `json:"skipped"`
	}
	if err := json.Unmarshal(conflict.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Count != 0 || len(result.Skipped) != 1 || result.Skipped[0].Reason != "规则名称已被占用" {
		t.Fatalf("name conflict result = %#v", result)
	}

	handler := srv.Handler()
	body := bytes.NewBufferString(`{"preset_ids":["apple"]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/recognition-rules/generate-geo", body)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d body=%s", rec.Code, rec.Body.String())
	}
	getReq := httptest.NewRequest(http.MethodGet, "/api/recognition-rules/geo-presets", nil)
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated get status=%d body=%s", getRec.Code, getRec.Body.String())
	}

	getReq = httptest.NewRequest(http.MethodGet, "/api/recognition-rules/geo-presets", nil)
	getReq.AddCookie(&http.Cookie{Name: sessionCookie, Value: srv.sessions.Create()})
	getRec = httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("authenticated get status=%d body=%s", getRec.Code, getRec.Body.String())
	}
}
