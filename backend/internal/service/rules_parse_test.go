package service

import "testing"

func TestParseTemplateContentReturnsEmptyArrays(t *testing.T) {
	parsed, err := ParseTemplateContent("rules:\n  - MATCH,DIRECT\n")
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Rules == nil || parsed.Providers == nil || parsed.Targets == nil {
		t.Fatalf("parsed template contains nil slices: %#v", parsed)
	}
	if len(parsed.Targets) != 0 || len(parsed.Providers) != 0 {
		t.Fatalf("unexpected template data: %#v", parsed)
	}
}
