package core

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"io"
	"testing"
)

func TestCoreAssetCandidates(t *testing.T) {
	windows := coreAssetCandidates("windows", "amd64", "v1.2.3")
	if len(windows) == 0 || windows[0] != "mihomo-windows-amd64-v1.2.3.zip" {
		t.Fatalf("unexpected windows candidates: %#v", windows)
	}
	darwin := coreAssetCandidates("darwin", "arm64", "v1.2.3")
	if len(darwin) == 0 || darwin[0] != "mihomo-darwin-arm64-v1.2.3.gz" {
		t.Fatalf("unexpected darwin candidates: %#v", darwin)
	}
}

func TestUnpackCorePayloadSupportsGzipAndZip(t *testing.T) {
	payload := bytes.Repeat([]byte("Mihomo"), 200_000)
	var gz bytes.Buffer
	writer := gzip.NewWriter(&gz)
	if _, err := writer.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	got, err := unpackCorePayload(gz.Bytes(), "mihomo.gz")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatal("gzip payload mismatch")
	}

	var zipped bytes.Buffer
	zipWriter := zip.NewWriter(&zipped)
	file, err := zipWriter.Create("mihomo.exe")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	got, err = unpackCorePayload(zipped.Bytes(), "mihomo.zip")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatal("zip payload mismatch")
	}

	if _, err := io.Copy(io.Discard, bytes.NewReader(got)); err != nil {
		t.Fatal(err)
	}
}
