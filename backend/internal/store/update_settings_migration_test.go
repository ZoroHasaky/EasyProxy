package store

import "testing"

func TestOpenRemovesDeprecatedPanelUpdateSettings(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetSetting("update_repo", "another/repository"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetSetting("update_via_proxy", "1"); err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	st, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if got := st.GetSetting("update_repo", ""); got != "" {
		t.Fatalf("update_repo=%q, want removed", got)
	}
	if got := st.GetSetting("update_via_proxy", ""); got != "" {
		t.Fatalf("update_via_proxy=%q, want removed", got)
	}
}
