package store

import "testing"

func TestOpenRemovesLegacyMRSProvidersAndRuleSetReferences(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(`INSERT INTO rule_providers(template_id,name,url,behavior,format,interval) VALUES
		(0,'legacy-mrs','https://example.com/legacy.mrs','domain','mrs',86400),
		(0,'keep-yaml','https://example.com/keep.yaml','domain','yaml',86400)`); err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(`INSERT INTO rules(template_id,kind,value,target,position,enabled) VALUES
		(0,'RULE-SET','legacy-mrs','DIRECT',0,1),
		(0,'RULE-SET','keep-yaml','DIRECT',1,1)`); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveAppliedConfigYAML("rule-providers:\n  legacy-mrs:\n    format: mrs\n"); err != nil {
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
	providers, err := st.ListCurrentRuleProviders()
	if err != nil || len(providers) != 1 || providers[0].Name != "keep-yaml" {
		t.Fatalf("providers after migration=%#v err=%v", providers, err)
	}
	rules, err := st.ListCurrentRules()
	if err != nil || len(rules) != 1 || rules[0].Value != "keep-yaml" {
		t.Fatalf("rules after migration=%#v err=%v", rules, err)
	}
	applied, err := st.AppliedConfigYAML()
	if err != nil || applied != "" {
		t.Fatalf("MRS applied snapshot was not cleared: %q err=%v", applied, err)
	}
}
