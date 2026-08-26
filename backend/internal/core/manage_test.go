package core

import (
	"errors"
	"strings"
	"testing"
)

func TestCoreDownloadSources(t *testing.T) {
	sources := coreDownloadSources(" https://mirror.example/https://github.com/ ")
	if len(sources) != len(CoreDownloadMirrors)+1 {
		t.Fatalf("source count = %d, want %d", len(sources), len(CoreDownloadMirrors)+1)
	}
	if sources[0].label != "自定义镜像" || sources[0].base != "https://mirror.example/https://github.com" {
		t.Fatalf("custom source = %#v", sources[0])
	}
	if sources[1].label != "内置镜像 1" {
		t.Fatalf("first builtin source = %#v", sources[1])
	}
	if sources[len(sources)-1].label != "GitHub 官方源" || sources[len(sources)-1].base != GitHubRelease {
		t.Fatalf("official source = %#v", sources[len(sources)-1])
	}
}

func TestDefaultCoreDownloadSourcesPreferMirrors(t *testing.T) {
	sources := coreDownloadSources("")
	if sources[0].label != "内置镜像 1" || sources[len(sources)-1].label != "GitHub 官方源" {
		t.Fatalf("default source order = %#v", sources)
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

func TestCoreValidationHint(t *testing.T) {
	tests := []struct {
		name  string
		cause error
		want  string
	}{
		{name: "instruction", cause: errors.New("signal: illegal instruction"), want: "CPU 指令集"},
		{name: "permission", cause: errors.New("permission denied"), want: "noexec"},
		{name: "format", cause: errors.New("exec format error"), want: "架构"},
		{name: "library", cause: errors.New("no such file or directory"), want: "动态库"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := coreValidationHint(tt.cause, ""); !strings.Contains(got, tt.want) {
				t.Fatalf("hint = %q, want containing %q", got, tt.want)
			}
		})
	}
}

func TestCoreValidationErrorIncludesDiagnostics(t *testing.T) {
	err := &CoreValidationError{
		OS:       "linux",
		Arch:     "amd64",
		FileSize: 2 << 20,
		Cause:    errors.New("signal: illegal instruction"),
		Output:   "Mihomo Meta v1.19.30",
		Hint:     "CPU 指令集不兼容",
	}
	message := err.Error()
	for _, want := range []string{"linux/amd64", "2.0 MiB", "CPU 指令集", "illegal instruction", "Mihomo Meta"} {
		if !strings.Contains(message, want) {
			t.Fatalf("error = %q, want containing %q", message, want)
		}
	}
}
