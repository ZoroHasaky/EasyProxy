package store

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
)

func TestRecognitionAndOutboundRulesPersistWithReferences(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.ReplaceGroups([]model.Group{{Name: "测试组", Type: "select", MemberMode: "manual", NodeIDs: []int64{1, 1, 2}, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	groups, _ := st.ListGroups()
	if len(groups) != 1 || len(groups[0].NodeIDs) != 2 {
		t.Fatalf("manual node IDs were not persisted uniquely: %#v", groups)
	}
	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{{
		Name: "PT", Kind: "DOMAIN", Conditions: []string{"pt.example", "pt.example", "tracker.example"}, Priority: 10, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	recognitions, _ := st.ListRecognitionRules()
	if len(recognitions) != 1 || len(recognitions[0].Conditions) != 2 || recognitions[0].Priority != 10 {
		t.Fatalf("recognition rule was not normalized: %#v", recognitions)
	}
	if err := st.ReplaceOutboundRules([]model.OutboundRule{{RecognitionID: recognitions[0].ID, GroupID: groups[0].ID, Enabled: true}}); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceRecognitionRules(nil); err == nil || !strings.Contains(err.Error(), "仍被 1 条出站规则引用") {
		t.Fatalf("deleting referenced recognition rule should fail, got %v", err)
	}
	if err := st.ReplaceGroups(nil); err == nil || !strings.Contains(err.Error(), "仍被 1 条出站规则引用") {
		t.Fatalf("deleting referenced group should fail, got %v", err)
	}
	if err := st.ReplaceOutboundRules(nil); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceRecognitionRules(nil); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceGroups(nil); err != nil {
		t.Fatal(err)
	}
}
