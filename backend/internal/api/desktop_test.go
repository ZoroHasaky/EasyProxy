package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"easyproxy/internal/store"
)

func TestDesktopReadyFile(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ready := filepath.Join(t.TempDir(), "nested", "ready.json")
	srv := NewWithOptions(st, t.TempDir(), "test", Options{DesktopMode: true, ReadyFile: ready})
	if err := srv.writeReadyFile("127.0.0.1:12345"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(ready)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	if result["url"] != "http://127.0.0.1:12345" || result["control_token"] == "" {
		t.Fatalf("unexpected ready file: %s", data)
	}
}
