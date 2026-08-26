package service

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRefreshGeoDataFilesDownloadsAndValidatesDatabases(t *testing.T) {
	geoData := func(category string) []byte {
		record := append(protoBytes(1, []byte(category)), protoBytes(2, nil)...)
		return protoBytes(1, record)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/geoip.dat":
			_, _ = w.Write(geoData("CN"))
		case "/geosite.dat":
			_, _ = w.Write(geoData("github"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	refreshed, err := RefreshGeoDataFiles(dir, map[string][]string{
		"geoip":   {server.URL + "/geoip.dat"},
		"geosite": {server.URL + "/geosite.dat"},
	}, []string{"geoip", "geosite"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(refreshed) != 2 || refreshed[0].Name != "GeoIP" || refreshed[1].Name != "GeoSite" {
		t.Fatalf("unexpected refresh result: %#v", refreshed)
	}
	items := GeoDataStatuses(dir, nil, true, true)
	if items[0].State != "loaded" || items[1].State != "loaded" || !items[0].CountsAvailable || !items[1].CountsAvailable {
		t.Fatalf("downloaded files were not usable: %#v", items)
	}
}

func TestRefreshGeoDataFilesRejectsNonDatabaseResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("<html>invalid</html>"))
	}))
	defer server.Close()

	if _, err := RefreshGeoDataFiles(t.TempDir(), map[string][]string{
		"geoip": {server.URL + "/geoip.dat"},
	}, []string{"geoip"}, ""); err == nil {
		t.Fatal("expected invalid database response to be rejected")
	}
}
