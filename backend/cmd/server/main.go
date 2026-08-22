package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"

	"ezproxy/internal/api"
	"ezproxy/internal/store"
	"ezproxy/internal/update"
)

var version = "dev"

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	defData := "/data"
	if runtime.GOOS == "windows" {
		defData = "./data"
	}
	dataDir := flag.String("data", envOr("EZPROXY_DATA", defData), "数据目录")
	addr := flag.String("addr", envOr("EZPROXY_ADDR", ":8080"), "监听地址")
	showVersion := flag.Bool("version", false, "显示版本号")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}

	log.SetFlags(log.LstdFlags)
	log.Printf("ezproxy %s 启动中 (data=%s, addr=%s, %s/%s)",
		version, *dataDir, *addr, runtime.GOOS, runtime.GOARCH)

	// 若 /data/bin 中存在更新版本的面板二进制则切换（Linux）
	update.ExecNewest(*dataDir, version)

	st, err := store.Open(*dataDir)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer st.Close()

	srv := api.New(st, *dataDir, version)
	srv.InitPassword()
	go srv.EnsureCoreStarted()

	if err := srv.Run(*addr); err != nil && err != http.ErrServerClosed {
		log.Fatalf("HTTP 服务异常: %v", err)
	}
}
