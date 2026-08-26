package core

import "testing"

func TestCoreDownloadSources(t *testing.T) {
	sources := coreDownloadSources(" https://mirror.example/https://github.com/ ")
	if len(sources) != len(CoreDownloadMirrors)+1 {
		t.Fatalf("source count = %d, want %d", len(sources), len(CoreDownloadMirrors)+1)
	}
	if sources[0].label != "自定义镜像" || sources[0].base != "https://mirror.example/https://github.com" {
		t.Fatalf("custom source = %#v", sources[0])
	}
	if sources[1].label != "GitHub 官方源" || sources[1].base != GitHubRelease {
		t.Fatalf("official source = %#v", sources[1])
	}
	if sources[2].label != "内置镜像 1" {
		t.Fatalf("first builtin source = %#v", sources[2])
	}
}

func TestCoreDownloadSourcesDeduplicatesCustomMirror(t *testing.T) {
	sources := coreDownloadSources(GitHubRelease)
	if len(sources) != len(CoreDownloadMirrors) {
		t.Fatalf("source count = %d, want %d", len(sources), len(CoreDownloadMirrors))
	}
	if sources[0].label != "自定义镜像" {
		t.Fatalf("duplicate source should keep custom label, got %#v", sources[0])
	}
}
