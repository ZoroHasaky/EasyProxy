package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// GeoDataStatus 是 GeoIP / GeoSite 本地文件的可用状态。条目数由文件自身的
// protobuf 结构统计，不依赖网络请求或内核管理接口。
type GeoDataStatus struct {
	Key        string     `json:"key"`
	Name       string     `json:"name"`
	File       string     `json:"file"`
	Source     string     `json:"source"`
	State      string     `json:"state"`
	Message    string     `json:"message"`
	SizeBytes  int64      `json:"size_bytes"`
	UpdatedAt  *time.Time `json:"updated_at,omitempty"`
	GroupCount int        `json:"group_count"`
	EntryCount int        `json:"entry_count"`
}

type geoDataDefinition struct {
	key  string
	name string
	file string
}

var geoDataDefinitions = []geoDataDefinition{
	{key: "geoip", name: "GeoIP", file: "GeoIP.dat"},
	{key: "geosite", name: "GeoSite", file: "GeoSite.dat"},
}

// GeoDataStatuses 返回当前落盘的 GeoIP/GeoSite 状态。Mihomo 运行时只会从
// geox-url 的首个地址下载文件，因此 source 也只展示该实际生效地址。
func GeoDataStatuses(dataDir string, sources map[string][]string, enabled, coreRunning bool) []GeoDataStatus {
	items := make([]GeoDataStatus, 0, len(geoDataDefinitions))
	for _, def := range geoDataDefinitions {
		status := GeoDataStatus{Key: def.key, Name: def.name, File: def.file, State: "not_downloaded", Message: "尚未下载"}
		if values := sources[def.key]; len(values) > 0 {
			status.Source = values[0]
		}

		path, file := geoDataPath(dataDir, def.file)
		status.File = file
		info, err := os.Stat(path)
		if err != nil {
			if !os.IsNotExist(err) {
				status.State = "error"
				status.Message = "无法读取文件：" + err.Error()
			}
			items = append(items, status)
			continue
		}
		if info.IsDir() {
			status.State = "error"
			status.Message = "数据路径不是文件"
			items = append(items, status)
			continue
		}

		groups, entries, err := geoDataFileCounts(path)
		status.SizeBytes = info.Size()
		updatedAt := info.ModTime()
		status.UpdatedAt = &updatedAt
		if err != nil {
			status.State = "error"
			status.Message = "文件格式异常：" + err.Error()
			items = append(items, status)
			continue
		}
		status.GroupCount = groups
		status.EntryCount = entries
		switch {
		case !enabled:
			status.State = "disabled"
			status.Message = "Geo 数据库已禁用"
		case coreRunning:
			status.State = "loaded"
			status.Message = "内核运行中，文件可用"
		default:
			status.State = "ready"
			status.Message = "文件可用，等待内核启动"
		}
		items = append(items, status)
	}
	return items
}

// geoDataPath 与 Mihomo 的路径选择保持一致：它会以不区分大小写的方式在数据目录
// 查找 GeoIP.dat/GeoSite.dat。这样既能识别 Linux 上新下载的标准文件名，也兼容旧版
// 面板曾使用的小写文件名。
func geoDataPath(dataDir, expectedName string) (string, string) {
	entries, err := os.ReadDir(dataDir)
	if err == nil {
		for _, entry := range entries {
			if strings.EqualFold(entry.Name(), expectedName) {
				return filepath.Join(dataDir, entry.Name()), entry.Name()
			}
		}
	}
	return filepath.Join(dataDir, expectedName), expectedName
}

// geoDataFileCounts 统计 v2ray/MetaCubeX .dat 文件的顶层分类和分类内条目。
// GeoIPList/GeoSiteList 均由字段 1 的重复嵌套消息组成；嵌套消息字段 2 分别是
// CIDR 与 Domain 的重复条目。只读取 protobuf 边界，不引入体积较大的 geodata 依赖。
func geoDataFileCounts(path string) (int, int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, 0, err
	}
	if len(data) == 0 {
		return 0, 0, fmt.Errorf("文件为空")
	}
	groups, entries := 0, 0
	err = scanProtoFields(data, func(field int, wire int, value []byte) {
		if field != 1 || wire != 2 {
			return
		}
		groups++
		_ = scanProtoFields(value, func(nestedField int, nestedWire int, _ []byte) {
			if nestedField == 2 && nestedWire == 2 {
				entries++
			}
		})
	})
	if err != nil {
		return 0, 0, err
	}
	if groups == 0 {
		return 0, 0, fmt.Errorf("未找到 Geo 数据条目")
	}
	return groups, entries, nil
}

// scanProtoFields 仅扫描 protobuf 的标准线格式，遇到截断或未知 wire type 会报错。
func scanProtoFields(data []byte, visit func(field int, wire int, value []byte)) error {
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
			_, n, err := readProtoVarint(data[offset:])
			if err != nil {
				return err
			}
			offset += n
			visit(field, wire, nil)
		case 1:
			if len(data)-offset < 8 {
				return fmt.Errorf("fixed64 字段截断")
			}
			offset += 8
			visit(field, wire, nil)
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
			visit(field, wire, data[offset:end])
			offset = end
		case 5:
			if len(data)-offset < 4 {
				return fmt.Errorf("fixed32 字段截断")
			}
			offset += 4
			visit(field, wire, nil)
		default:
			return fmt.Errorf("不支持的 wire type %d", wire)
		}
	}
	return nil
}

func readProtoVarint(data []byte) (uint64, int, error) {
	var value uint64
	for i, b := range data {
		if i == 10 || (i == 9 && b > 1) {
			return 0, 0, fmt.Errorf("varint 过长")
		}
		value |= uint64(b&0x7f) << (7 * i)
		if b < 0x80 {
			return value, i + 1, nil
		}
	}
	return 0, 0, fmt.Errorf("varint 截断")
}
