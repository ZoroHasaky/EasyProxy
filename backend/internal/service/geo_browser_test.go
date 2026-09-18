package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGeoDataBrowserListsCategoriesAndEntries(t *testing.T) {
	dir := t.TempDir()
	geoIP := append(
		testGeoCategory("CN", testGeoIPEntry([]byte{1, 2, 3, 0}, 24), testGeoIPEntry([]byte{10, 0, 0, 0}, 8)),
		testGeoCategory("PRIVATE", testGeoIPEntry([]byte{127, 0, 0, 0}, 8))...,
	)
	geoSite := testGeoCategory("github", testGeoSiteEntry(2, "github.com"), testGeoSiteEntry(3, "api.github.com"))
	if err := os.WriteFile(filepath.Join(dir, "GeoIP.dat"), geoIP, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "GeoSite.dat"), geoSite, 0o644); err != nil {
		t.Fatal(err)
	}

	browser := NewGeoDataBrowser(dir)
	categories, err := browser.ListCategories("geoip", "pri")
	if err != nil {
		t.Fatal(err)
	}
	if categories.Total != 1 || categories.Categories[0].Name != "PRIVATE" || categories.Categories[0].EntryCount != 1 {
		t.Fatalf("categories=%#v", categories)
	}

	entries, err := browser.ListEntries("geoip", "cn", "10.0", 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if entries.Category != "CN" || entries.Total != 1 || len(entries.Entries) != 1 || entries.Entries[0].Value != "10.0.0.0/8" || entries.Entries[0].EntryType != "cidr" {
		t.Fatalf("entries=%#v", entries)
	}

	siteEntries, err := browser.ListEntries("geosite", "GITHUB", "api", 1, 100)
	if err != nil {
		t.Fatal(err)
	}
	if siteEntries.Total != 1 || len(siteEntries.Entries) != 1 || siteEntries.Entries[0].Value != "api.github.com" || siteEntries.Entries[0].EntryType != "full" {
		t.Fatalf("site entries=%#v", siteEntries)
	}
}

func TestGeoDataBrowserRejectsInvalidAndUnknownCategories(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "GeoSite.dat"), []byte{0x0a}, 0o644); err != nil {
		t.Fatal(err)
	}
	browser := NewGeoDataBrowser(dir)
	if _, err := browser.ListCategories("geosite", ""); err == nil {
		t.Fatal("expected invalid file error")
	}
	if _, err := browser.ListEntries("geoip", "CN", "", 1, 100); err == nil {
		t.Fatal("expected missing file error")
	}
}

func testGeoCategory(name string, entries ...[]byte) []byte {
	body := protoBytes(1, []byte(name))
	for _, entry := range entries {
		body = append(body, protoBytes(2, entry)...)
	}
	return protoBytes(1, body)
}

func testGeoIPEntry(ip []byte, prefix uint64) []byte {
	body := protoBytes(1, ip)
	body = append(body, testProtoVarint(2, prefix)...)
	return body
}

func testGeoSiteEntry(entryType uint64, value string) []byte {
	body := testProtoVarint(1, entryType)
	body = append(body, protoBytes(2, []byte(value))...)
	return body
}

func testProtoVarint(field int, value uint64) []byte {
	out := []byte{byte(field << 3)}
	for value >= 0x80 {
		out = append(out, byte(value)|0x80)
		value >>= 7
	}
	return append(out, byte(value))
}
