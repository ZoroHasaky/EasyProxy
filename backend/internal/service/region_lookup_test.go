package service

import (
	"context"
	"net"
	"testing"

	"easyproxy/internal/model"
	"easyproxy/internal/store"
)

func stubUSRegionLookup(t *testing.T) {
	t.Helper()
	originalIPLookup := lookupIPAddr
	originalTXTLookup := lookupTXT
	lookupIPAddr = func(_ context.Context, host string) ([]net.IPAddr, error) {
		if host != "panel.xiaxiazi.ccwu.cc" {
			t.Fatalf("unexpected host lookup: %s", host)
		}
		return []net.IPAddr{{IP: net.ParseIP("204.152.197.186")}}, nil
	}
	lookupTXT = func(_ context.Context, query string) ([]string, error) {
		if query != "186.197.152.204.origin.asn.cymru.com" {
			t.Fatalf("unexpected TXT query: %s", query)
		}
		return []string{"36352 | 204.152.197.0/24 | US | arin | 2024-12-13"}, nil
	}
	t.Cleanup(func() {
		lookupIPAddr = originalIPLookup
		lookupTXT = originalTXTLookup
	})
}

func TestResolveRegionFromHost(t *testing.T) {
	stubUSRegionLookup(t)
	if got := resolveRegionFromHost("panel.xiaxiazi.ccwu.cc"); got != "US" {
		t.Fatalf("region=%s, want US", got)
	}
}

func TestImportManualNodeUsesServerIPRegion(t *testing.T) {
	stubUSRegionLookup(t)
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	link := "vless://7f08a6d1-069d-4721-b594-bb8c3d5e1be5@panel.xiaxiazi.ccwu.cc:18443?security=reality&encryption=none&pbk=fyuLR2d6tkcSX_YZpIvh8ROGsU6-hw9Mdp5lFu_Rszo&fp=chrome&sni=www.cloudflare.com&sid=0786ce5392c2f1&type=tcp&flow=xtls-rprx-vision#California-ipad%7C%F0%9F%93%8A999.82GB"
	added, duplicated, err := ImportNodes(st, link)
	if err != nil {
		t.Fatal(err)
	}
	if added != 1 || duplicated != 0 {
		t.Fatalf("added=%d duplicated=%d, want 1/0", added, duplicated)
	}
	nodes, err := st.ListNodes(model.NodeFilter{Source: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 || nodes[0].Region != "US" {
		t.Fatalf("nodes=%#v, want one US node", nodes)
	}
}
