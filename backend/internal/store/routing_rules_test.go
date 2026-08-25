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
	if err := st.ReplaceRecognitionRules(nil); err == nil || !strings.Contains(err.Error(), "仍被 1 条出站映射引用") {
		t.Fatalf("deleting referenced recognition rule should fail, got %v", err)
	}
	if err := st.ReplaceGroups(nil); err == nil || !strings.Contains(err.Error(), "仍被 1 条出站映射引用") {
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

func TestCreateRemoteYAMLRecognitionRulesIsAtomicAndRejectsMRS(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	created, err := st.CreateRecognitionRules([]model.RecognitionRule{
		{Name: "apple", SourceURL: "https://example.com/apple.yaml", SourceBehavior: "domain", SourceInterval: 86400, Enabled: true},
		{Name: "private-ip", SourceURL: "https://example.com/private.yaml", SourceBehavior: "ipcidr", Enabled: true},
	})
	if err != nil || len(created) != 2 {
		t.Fatalf("created=%#v err=%v", created, err)
	}
	if created[0].Kind != "RULE-SET" || created[1].SourceInterval != 86400 {
		t.Fatalf("remote rules were not normalized: %#v", created)
	}
	if _, err := st.CreateRecognitionRules([]model.RecognitionRule{
		{Name: "apple", SourceURL: "https://example.com/another.yaml", SourceBehavior: "domain"},
		{Name: "new", SourceURL: "https://example.com/new.yaml", SourceBehavior: "domain"},
	}); err == nil || !strings.Contains(err.Error(), "已存在") {
		t.Fatalf("duplicate batch should be rejected atomically, got %v", err)
	}
	rules, err := st.ListRecognitionRules()
	if err != nil || len(rules) != 2 {
		t.Fatalf("failed batch changed persisted rules=%#v err=%v", rules, err)
	}
	if _, err := st.CreateRecognitionRules([]model.RecognitionRule{{
		Name: "legacy", SourceURL: "https://example.com/legacy.mrs", SourceBehavior: "domain",
	}}); err == nil || !strings.Contains(err.Error(), "MRS") {
		t.Fatalf("MRS source should be rejected, got %v", err)
	}
}
