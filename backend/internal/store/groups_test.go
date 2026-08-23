package store

import (
	"testing"

	"easyproxy/internal/model"
)

func TestReplaceGroupsPreservesIDsAcrossRenameAndReorder(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.ReplaceGroups([]model.Group{{Name: "香港", Enabled: true}, {Name: "美国", Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	before, _ := st.ListGroups()
	firstID, secondID := before[0].ID, before[1].ID
	before[0].Name = "美国"
	before[1].Name = "香港"
	if err := st.ReplaceGroups([]model.Group{before[1], before[0]}); err != nil {
		t.Fatal(err)
	}
	after, _ := st.ListGroups()
	if after[0].ID != secondID || after[0].Name != "香港" {
		t.Fatalf("first group = %#v", after[0])
	}
	if after[1].ID != firstID || after[1].Name != "美国" {
		t.Fatalf("second group = %#v", after[1])
	}
}
