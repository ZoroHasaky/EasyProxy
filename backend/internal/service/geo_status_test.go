package service

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGeoDataStatusesCountsDatEntries(t *testing.T) {
	dir := t.TempDir()
	// 两个顶层分类；每个分类有字段 2 的两个/一个子条目。
	data := append(protoBytes(1, append(protoBytes(2, nil), protoBytes(2, nil)...)), protoBytes(1, protoBytes(2, nil))...)
	if err := os.WriteFile(filepath.Join(dir, "geoip.dat"), data, 0o644); err != nil {
		t.Fatal(err)
	}

	items := GeoDataStatuses(dir, map[string][]string{"geoip": {"https://example.com/geoip.dat"}}, true, true)
	if len(items) != 2 {
		t.Fatalf("status count = %d, want 2", len(items))
	}
	geoIP := items[0]
	if geoIP.State != "loaded" || geoIP.GroupCount != 2 || geoIP.EntryCount != 3 {
		t.Fatalf("geoip status = %#v", geoIP)
	}
	if geoIP.Source != "https://example.com/geoip.dat" || geoIP.UpdatedAt == nil {
		t.Fatalf("geoip source/timestamp = %#v", geoIP)
	}
	if items[1].State != "not_downloaded" {
		t.Fatalf("geosite state = %#v", items[1])
	}
}

func TestGeoDataStatusesRejectsInvalidFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "geosite.dat"), []byte{0x0a}, 0o644); err != nil {
		t.Fatal(err)
	}
	items := GeoDataStatuses(dir, nil, true, false)
	if items[1].State != "error" {
		t.Fatalf("geosite status = %#v", items[1])
	}
}

func protoBytes(field int, value []byte) []byte {
	// 测试数据的字段与长度均很小，因此一个字节 varint 即可。
	return append([]byte{byte(field<<3 | 2), byte(len(value))}, value...)
}
