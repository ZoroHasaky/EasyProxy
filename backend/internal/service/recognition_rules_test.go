package service

import (
	"strings"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func TestGenerateConfigExpandsRecognitionConditionsByPriority(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	node := testNode(0, "PT 节点", "pt-node", "HK", true)
	if err := st.CreateNode(&node); err != nil {
		t.Fatal(err)
	}
	if err := st.ReplaceGroups([]model.Group{{
		Name: "PT 策略组", Type: "select", MemberMode: "manual", NodeIDs: []int64{node.ID}, Enabled: true,
	}}); err != nil {
		t.Fatal(err)
	}
	groups, _ := st.ListGroups()
	if err := st.ReplaceRecognitionRules([]model.RecognitionRule{
		{Name: "普通域名", Kind: "DOMAIN-SUFFIX", Conditions: []string{"example.com"}, Priority: 0, Enabled: true},
		{Name: "PT 站点", Kind: "DOMAIN", Conditions: []string{"pt.example", "tracker.example"}, Priority: 100, Enabled: true},
	}); err != nil {
		t.Fatal(err)
	}
	recognitions, _ := st.ListRecognitionRules()
	outbounds := make([]model.OutboundRule, 0, len(recognitions))
	for _, recognition := range recognitions {
		outbounds = append(outbounds, model.OutboundRule{
			RecognitionID: recognition.ID, GroupID: groups[0].ID, Enabled: true,
		})
	}
	if err := st.ReplaceOutboundRules(outbounds); err != nil {
		t.Fatal(err)
	}

	generated, err := GenerateConfig(st)
	if err != nil {
		t.Fatal(err)
	}
	ptIndex := strings.Index(generated.YAML, "DOMAIN,pt.example,PT 策略组")
	trackerIndex := strings.Index(generated.YAML, "DOMAIN,tracker.example,PT 策略组")
	lowIndex := strings.Index(generated.YAML, "DOMAIN-SUFFIX,example.com,PT 策略组")
	if ptIndex < 0 || trackerIndex < 0 || lowIndex < 0 {
		t.Fatalf("recognition conditions were not expanded:\n%s", generated.YAML)
	}
	if ptIndex > lowIndex || trackerIndex > lowIndex {
		t.Fatalf("higher priority recognition rule was emitted after lower priority rule:\n%s", generated.YAML)
	}
	if strings.Contains(generated.YAML, "rule-providers:") {
		t.Fatalf("legacy remote rule providers should not be emitted:\n%s", generated.YAML)
	}
}
