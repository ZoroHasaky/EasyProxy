package store

import (
	"testing"

	"easyproxy/internal/model"
)

func TestMigrateLegacyGroupTargetsToStableRefs(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceGroups([]model.Group{{Name: "香港组", Region: "HK", Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	groups, _ := st.ListGroups()
	tpl := &model.Template{
		Name: "legacy", Source: "paste", Content: "rules:\n  - MATCH,香港组\n",
		Mapping: map[string]string{"节点选择": "香港组"},
	}
	if err := st.CreateTemplate(tpl); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceRules(tpl.ID, []model.Rule{{Kind: "MATCH", Target: "香港组", BaseTarget: "香港组", Enabled: true}}, nil); err != nil {
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
	want := model.GroupTargetRef(groups[0].ID)
	rules, _ := st.ListRules(tpl.ID)
	if rules[0].Target != want || rules[0].BaseTarget != want {
		t.Fatalf("migrated rule = %#v, want target %q", rules[0], want)
	}
	fresh, _ := st.GetTemplate(tpl.ID)
	if fresh.Mapping["节点选择"] != want {
		t.Fatalf("migrated mapping = %#v, want %q", fresh.Mapping, want)
	}
}
