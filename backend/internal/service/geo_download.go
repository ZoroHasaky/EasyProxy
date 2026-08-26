package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxGeoDataDownloadSize = 128 << 20

// GeoDataDownload 是一次经面板补齐的 Geo 数据文件。仅用于记录实际完成的文件，
// 不保存包含完整 URL 的敏感或冗余运行状态。
type GeoDataDownload struct {
	Key       string
	Name      string
	File      string
	SizeBytes int64
}

// RefreshGeoDataFiles 按当前生效数据源下载指定的 GeoIP / GeoSite 文件。
// Mihomo 在没有任何 GEOIP/GEOSITE 规则时不会初始化相应数据库，手动更新接口
// 会因此成功返回却没有文件落盘；该函数负责补齐这部分显式请求的离线数据。
func RefreshGeoDataFiles(dataDir string, sources map[string][]string, keys []string, proxyAddr string) ([]GeoDataDownload, error) {
	requested := make(map[string]bool, len(keys))
	for _, key := range keys {
		requested[key] = true
	}
	for key := range requested {
		if key != "geoip" && key != "geosite" {
			return nil, fmt.Errorf("不支持的 Geo 数据类型：%s", key)
		}
	}
	if len(requested) == 0 {
		return nil, nil
	}

	client, err := newGeoDownloadClient(proxyAddr)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("创建 Geo 数据目录失败：%w", err)
	}

	results := make([]GeoDataDownload, 0, len(requested))
	for _, def := range geoDataDefinitions {
		if !requested[def.key] {
			continue
		}
		urls := sources[def.key]
		if len(urls) == 0 || strings.TrimSpace(urls[0]) == "" {
			return nil, fmt.Errorf("%s 未配置当前生效数据源", def.name)
		}
		path, file := geoDataPath(dataDir, def.file)
		size, err := downloadGeoDataFile(client, strings.TrimSpace(urls[0]), path)
		if err != nil {
			return nil, fmt.Errorf("下载 %s 失败：%w", def.name, err)
		}
		results = append(results, GeoDataDownload{Key: def.key, Name: def.name, File: file, SizeBytes: size})
	}
	return results, nil
}

func newGeoDownloadClient(proxyAddr string) (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if proxyAddr != "" {
		proxyURL, err := url.Parse("http://" + proxyAddr)
		if err != nil {
			return nil, fmt.Errorf("Geo 下载代理地址无效：%w", err)
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	return &http.Client{Transport: transport, Timeout: 2 * time.Minute}, nil
}

func downloadGeoDataFile(client *http.Client, source, target string) (int64, error) {
	parsed, err := url.ParseRequestURI(source)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return 0, fmt.Errorf("数据源 URL 无效")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", "EasyProxy")
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return 0, fmt.Errorf("服务器返回 HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxGeoDataDownloadSize+1))
	if err != nil {
		return 0, err
	}
	if len(data) > maxGeoDataDownloadSize {
		return 0, fmt.Errorf("数据文件超过 %d MB 限制", maxGeoDataDownloadSize>>20)
	}
	if _, _, _, err := geoDataBytesMetadata(data); err != nil {
		return 0, fmt.Errorf("数据文件格式异常：%w", err)
	}

	temp, err := os.CreateTemp(filepath.Dir(target), ".easyproxy-geo-*")
	if err != nil {
		return 0, err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		return 0, err
	}
	if err := temp.Close(); err != nil {
		return 0, err
	}
	if err := os.Rename(tempPath, target); err != nil {
		return 0, fmt.Errorf("替换数据文件失败：%w", err)
	}
	return int64(len(data)), nil
}
