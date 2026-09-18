package service

import (
	"fmt"
	"net"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// GeoDataCategory 是本地 Geo 数据文件中的一个可引用分类。
type GeoDataCategory struct {
	Name       string `json:"name"`
	EntryCount int    `json:"entry_count"`
}

// GeoDataCategoriesResult 是分类浏览接口的返回值。
type GeoDataCategoriesResult struct {
	Key        string            `json:"key"`
	File       string            `json:"file"`
	Categories []GeoDataCategory `json:"categories"`
	Total      int               `json:"total"`
}

// GeoDataEntry 是 GeoIP CIDR 或 GeoSite 域名条目。
type GeoDataEntry struct {
	Value     string `json:"value"`
	EntryType string `json:"entry_type"`
}

// GeoDataEntriesResult 是分类条目分页接口的返回值。
type GeoDataEntriesResult struct {
	Key      string         `json:"key"`
	Category string         `json:"category"`
	Page     int            `json:"page"`
	PageSize int            `json:"page_size"`
	Total    int            `json:"total"`
	HasMore  bool           `json:"has_more"`
	Entries  []GeoDataEntry `json:"entries"`
}

type geoBrowseCategory struct {
	Name    string
	Entries []GeoDataEntry
}

type geoBrowseIndex struct {
	Key        string
	File       string
	Categories map[string]*geoBrowseCategory
}

type geoBrowseCache struct {
	File    string
	Size    int64
	ModTime time.Time
	Index   *geoBrowseIndex
	Err     error
}

// GeoDataBrowser lazily parses and caches the local GeoIP/GeoSite files.
// The cache is invalidated when the file size or modification time changes.
type GeoDataBrowser struct {
	dataDir string
	mu      sync.Mutex
	cache   map[string]geoBrowseCache
}

func NewGeoDataBrowser(dataDir string) *GeoDataBrowser {
	return &GeoDataBrowser{dataDir: dataDir, cache: map[string]geoBrowseCache{}}
}

// ListCategories returns all categories, optionally filtered by name.
func (b *GeoDataBrowser) ListCategories(key, query string) (GeoDataCategoriesResult, error) {
	index, err := b.load(key)
	if err != nil {
		return GeoDataCategoriesResult{}, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	categories := make([]GeoDataCategory, 0, len(index.Categories))
	for _, category := range index.Categories {
		if query != "" && !strings.Contains(strings.ToLower(category.Name), query) {
			continue
		}
		categories = append(categories, GeoDataCategory{Name: category.Name, EntryCount: len(category.Entries)})
	}
	sort.Slice(categories, func(i, j int) bool {
		return strings.ToLower(categories[i].Name) < strings.ToLower(categories[j].Name)
	})
	return GeoDataCategoriesResult{Key: index.Key, File: index.File, Categories: categories, Total: len(categories)}, nil
}

// ListEntries returns one page of entries from a category.
func (b *GeoDataBrowser) ListEntries(key, category, query string, page, pageSize int) (GeoDataEntriesResult, error) {
	index, err := b.load(key)
	if err != nil {
		return GeoDataEntriesResult{}, err
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 100
	}
	if pageSize > 200 {
		pageSize = 200
	}
	categoryKey := strings.ToLower(strings.TrimSpace(category))
	selected, ok := index.Categories[categoryKey]
	if !ok {
		return GeoDataEntriesResult{}, fmt.Errorf("Geo 分类不存在：%s", strings.TrimSpace(category))
	}
	query = strings.ToLower(strings.TrimSpace(query))
	filtered := make([]GeoDataEntry, 0, len(selected.Entries))
	for _, entry := range selected.Entries {
		if query != "" && !strings.Contains(strings.ToLower(entry.Value), query) && !strings.Contains(strings.ToLower(entry.EntryType), query) {
			continue
		}
		filtered = append(filtered, entry)
	}
	start := 0
	if page > 1 {
		if page-1 > len(filtered)/pageSize {
			start = len(filtered)
		} else {
			start = (page - 1) * pageSize
		}
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	entries := append([]GeoDataEntry(nil), filtered[start:end]...)
	return GeoDataEntriesResult{
		Key:      index.Key,
		Category: selected.Name,
		Page:     page,
		PageSize: pageSize,
		Total:    len(filtered),
		HasMore:  end < len(filtered),
		Entries:  entries,
	}, nil
}

func (b *GeoDataBrowser) load(key string) (*geoBrowseIndex, error) {
	def, ok := geoDataDefinitionByKey(key)
	if !ok {
		return nil, fmt.Errorf("不支持的 Geo 数据类型：%s", key)
	}
	path, file := geoDataPath(b.dataDir, def.file)
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("Geo 数据路径不是文件：%s", file)
	}

	b.mu.Lock()
	cached, exists := b.cache[def.key]
	if exists && cached.File == file && cached.Size == info.Size() && cached.ModTime.Equal(info.ModTime()) {
		index, cachedErr := cached.Index, cached.Err
		b.mu.Unlock()
		return index, cachedErr
	}
	b.mu.Unlock()

	data, err := os.ReadFile(path)
	var index *geoBrowseIndex
	if err == nil {
		index, err = parseGeoBrowseIndex(def.key, file, data)
	}

	b.mu.Lock()
	b.cache[def.key] = geoBrowseCache{File: file, Size: info.Size(), ModTime: info.ModTime(), Index: index, Err: err}
	b.mu.Unlock()
	return index, err
}

func geoDataDefinitionByKey(key string) (geoDataDefinition, bool) {
	key = strings.ToLower(strings.TrimSpace(key))
	for _, def := range geoDataDefinitions {
		if def.key == key {
			return def, true
		}
	}
	return geoDataDefinition{}, false
}

func parseGeoBrowseIndex(key, file string, data []byte) (*geoBrowseIndex, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("文件为空")
	}
	index := &geoBrowseIndex{Key: key, File: file, Categories: map[string]*geoBrowseCategory{}}
	var parseErr error
	err := scanGeoProtoFields(data, func(field, wire int, bytesValue []byte, _ uint64) {
		if parseErr != nil || field != 1 || wire != 2 {
			return
		}
		var name string
		entries := make([]GeoDataEntry, 0)
		nestedErr := scanGeoProtoFields(bytesValue, func(nestedField, nestedWire int, nestedBytes []byte, nestedVarint uint64) {
			if parseErr != nil {
				return
			}
			if nestedField == 1 && nestedWire == 2 {
				name = strings.TrimSpace(string(nestedBytes))
				return
			}
			if nestedField != 2 || nestedWire != 2 {
				return
			}
			var entry GeoDataEntry
			var err error
			if key == "geoip" {
				entry, err = decodeGeoIPEntry(nestedBytes)
			} else {
				entry, err = decodeGeoSiteEntry(nestedBytes)
			}
			if err != nil {
				parseErr = err
				return
			}
			entries = append(entries, entry)
			_ = nestedVarint
		})
		if nestedErr != nil {
			parseErr = nestedErr
			return
		}
		if name == "" {
			parseErr = fmt.Errorf("Geo 分类名称为空")
			return
		}
		categoryKey := strings.ToLower(name)
		if existing := index.Categories[categoryKey]; existing != nil {
			existing.Entries = append(existing.Entries, entries...)
			return
		}
		index.Categories[categoryKey] = &geoBrowseCategory{Name: name, Entries: entries}
	})
	if err != nil {
		return nil, err
	}
	if parseErr != nil {
		return nil, parseErr
	}
	if len(index.Categories) == 0 {
		return nil, fmt.Errorf("未找到 Geo 数据条目")
	}
	for _, category := range index.Categories {
		sort.SliceStable(category.Entries, func(i, j int) bool {
			left := strings.ToLower(category.Entries[i].Value)
			right := strings.ToLower(category.Entries[j].Value)
			if left == right {
				return category.Entries[i].EntryType < category.Entries[j].EntryType
			}
			return left < right
		})
	}
	return index, nil
}

func decodeGeoIPEntry(data []byte) (GeoDataEntry, error) {
	var ipBytes []byte
	var prefix uint64
	var prefixSet bool
	if err := scanGeoProtoFields(data, func(field, wire int, bytesValue []byte, varintValue uint64) {
		switch {
		case field == 1 && wire == 2:
			ipBytes = append([]byte(nil), bytesValue...)
		case field == 2 && wire == 0:
			prefix = varintValue
			prefixSet = true
		}
	}); err != nil {
		return GeoDataEntry{}, err
	}
	if len(ipBytes) != net.IPv4len && len(ipBytes) != net.IPv6len {
		return GeoDataEntry{}, fmt.Errorf("GeoIP 条目 IP 长度无效：%d", len(ipBytes))
	}
	bits := uint64(len(ipBytes) * 8)
	if !prefixSet || prefix > bits {
		return GeoDataEntry{}, fmt.Errorf("GeoIP 条目掩码无效：%d", prefix)
	}
	return GeoDataEntry{Value: fmt.Sprintf("%s/%d", net.IP(ipBytes).String(), prefix), EntryType: "cidr"}, nil
}

func decodeGeoSiteEntry(data []byte) (GeoDataEntry, error) {
	var entryType uint64
	var value string
	if err := scanGeoProtoFields(data, func(field, wire int, bytesValue []byte, varintValue uint64) {
		switch {
		case field == 1 && wire == 0:
			entryType = varintValue
		case field == 2 && wire == 2:
			value = strings.TrimSpace(string(bytesValue))
		}
	}); err != nil {
		return GeoDataEntry{}, err
	}
	if value == "" {
		return GeoDataEntry{}, fmt.Errorf("GeoSite 条目值为空")
	}
	return GeoDataEntry{Value: value, EntryType: geoSiteEntryType(entryType)}, nil
}

func geoSiteEntryType(value uint64) string {
	switch value {
	case 0:
		return "plain"
	case 1:
		return "regexp"
	case 2:
		return "root-domain"
	case 3:
		return "full"
	default:
		return fmt.Sprintf("type-%d", value)
	}
}

func scanGeoProtoFields(data []byte, visit func(field int, wire int, bytesValue []byte, varintValue uint64)) error {
	for offset := 0; offset < len(data); {
		tag, n, err := readProtoVarint(data[offset:])
		if err != nil {
			return err
		}
		offset += n
		field, wire := int(tag>>3), int(tag&7)
		if field == 0 {
			return fmt.Errorf("字段编号无效")
		}
		switch wire {
		case 0:
			value, n, err := readProtoVarint(data[offset:])
			if err != nil {
				return err
			}
			offset += n
			visit(field, wire, nil, value)
		case 1:
			if len(data)-offset < 8 {
				return fmt.Errorf("fixed64 字段截断")
			}
			offset += 8
			visit(field, wire, nil, 0)
		case 2:
			length, n, err := readProtoVarint(data[offset:])
			if err != nil {
				return err
			}
			offset += n
			if length > uint64(len(data)-offset) {
				return fmt.Errorf("长度字段截断")
			}
			end := offset + int(length)
			visit(field, wire, data[offset:end], 0)
			offset = end
		case 5:
			if len(data)-offset < 4 {
				return fmt.Errorf("fixed32 字段截断")
			}
			offset += 4
			visit(field, wire, nil, 0)
		default:
			return fmt.Errorf("不支持的 wire type %d", wire)
		}
	}
	return nil
}
