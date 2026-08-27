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

func TestRecommendedCoreDownloadAsset(t *testing.T) {
	v3CPUInfo := "flags\t\t: fpu avx avx2 bmi1 bmi2 f16c fma lzcnt movbe\n"
	standard := recommendedCoreDownloadAsset("linux", "amd64", v3CPUInfo)
	if standard.Variant != "standard" || standard.AssetArch != "amd64" {
		t.Fatalf("v3 asset = %#v", standard)
	}

	compatible := recommendedCoreDownloadAsset("linux", "amd64", "flags : fpu sse2\n")
	if compatible.Variant != "compatible" || compatible.AssetArch != "amd64-compatible" || len(compatible.MissingFeatures) == 0 {
		t.Fatalf("compatible asset = %#v", compatible)
	}

	arm64 := recommendedCoreDownloadAsset("linux", "arm64", "")
	if arm64.Variant != "standard" || arm64.AssetArch != "arm64" {
		t.Fatalf("arm64 asset = %#v", arm64)
	}
}

func TestValidateOfficialCoreDownloadURL(t *testing.T) {
	standard := CoreDownloadAsset{AssetArch: "amd64", Variant: "standard"}
	compatible := CoreDownloadAsset{AssetArch: "amd64-compatible", Variant: "compatible"}
	cases := []struct {
		name  string
		url   string
		asset CoreDownloadAsset
		want  string
		err   bool
	}{
		{
			name:  "standard amd64",
			url:   "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.30/mihomo-linux-amd64-v1.19.30.gz",
			asset: standard,
			want:  "v1.19.30",
		},
		{
			name:  "compatible amd64",
			url:   "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.30/mihomo-linux-amd64-compatible-v1.19.30.gz",
			asset: compatible,
			want:  "v1.19.30",
		},
		{
			name:  "wrong architecture",
			url:   "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.30/mihomo-linux-amd64-v1.19.30.gz",
			asset: compatible,
			err:   true,
		},
		{
			name:  "non official host",
			url:   "https://example.com/mihomo-linux-amd64-v1.19.30.gz",
			asset: standard,
			err:   true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := validateOfficialCoreDownloadURL(c.url, c.asset)
			if (err != nil) != c.err {
				t.Fatalf("validateOfficialCoreDownloadURL() error=%v", err)
			}
			if got != c.want {
				t.Fatalf("version=%q, want %q", got, c.want)
			}
		})
	}
}
