package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"os"
	"path/filepath"
	goruntime "runtime"
	"sync/atomic"

	"github.com/getlantern/systray"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed assets/*
var assets embed.FS

//go:embed assets/tray.ico
var trayICO []byte

//go:embed assets/tray.png
var trayRegular []byte

//go:embed assets/tray-template.png
var trayTemplate []byte

var version = "dev"

type App struct {
	ctx      context.Context
	backend  *BackendProcess
	quitting atomic.Bool
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	dataDir, err := desktopDataDir()
	if err != nil {
		log.Printf("[desktop] 数据目录初始化失败: %v", err)
		return
	}
	serverPath, err := resolveBackendPath()
	if err != nil {
		log.Printf("[desktop] 找不到后端程序: %v", err)
		return
	}
	a.backend = NewBackendProcess(serverPath, dataDir, version)
	if err := a.backend.Start(); err != nil {
		log.Printf("[desktop] 后端启动失败: %v", err)
		return
	}
	go a.runTray()
}

func (a *App) shutdown(_ context.Context) {
	if a.backend != nil {
		if err := a.backend.Stop(); err != nil {
			log.Printf("[desktop] 后端停止失败: %v", err)
		}
	}
	if a.quitting.Load() {
		// Remove the tray icon after the backend has had a chance to restore
		// the system proxy and stop Mihomo.
		systray.Quit()
	}
}

func (a *App) beforeClose(ctx context.Context) bool {
	if a.quitting.Load() {
		return false
	}
	wailsruntime.WindowHide(ctx)
	return true
}

func (a *App) requestQuit() {
	if !a.quitting.CompareAndSwap(false, true) {
		return
	}
	// The shutdown callback stops the backend first and then removes the tray
	// icon. Closing the window alone never reaches this method and therefore
	// only hides the UI.
	if a.ctx != nil {
		wailsruntime.Quit(a.ctx)
	} else {
		systray.Quit()
	}
}

// BackendURL is called by the tiny embedded boot page before navigating to the
// real React application served by the backend child process.
func (a *App) BackendURL() string {
	if a.backend == nil {
		return ""
	}
	return a.backend.URL()
}

func (a *App) runTray() {
	systray.Run(func() {
		systray.SetTemplateIcon(trayTemplate, trayRegular)
		// Windows requires an ICO resource for the notification area. The
		// cross-platform tray implementation uses the regular PNG fallback on
		// macOS and Linux.
		if goruntime.GOOS == "windows" {
			systray.SetIcon(trayICO)
		}
		systray.SetTitle("EasyProxy")
		systray.SetTooltip("EasyProxy")
		open := systray.AddMenuItem("打开 EasyProxy", "显示管理面板")
		restart := systray.AddMenuItem("重启后端", "重启本地后端服务")
		proxy := systray.AddMenuItem("切换系统代理", "开启或关闭系统代理")
		systray.AddSeparator()
		quit := systray.AddMenuItem("退出 EasyProxy", "停止代理并退出")
		go func() {
			for {
				select {
				case <-open.ClickedCh:
					if a.ctx != nil {
						wailsruntime.WindowShow(a.ctx)
					}
				case <-restart.ClickedCh:
					if a.backend != nil {
						if err := a.backend.Restart(); err != nil {
							log.Printf("[desktop] 后端重启失败: %v", err)
						}
					}
				case <-proxy.ClickedCh:
					if a.backend != nil {
						if err := a.backend.toggleSystemProxy(); err != nil {
							log.Printf("[desktop] 系统代理切换失败: %v", err)
						}
					}
				case <-quit.ClickedCh:
					a.requestQuit()
					return
				}
			}
		}()
	}, func() {
		log.Printf("[desktop] 托盘已退出")
	})
}

func desktopDataDir() (string, error) {
	// Keep desktop data in the platform-specific user data location. Windows
	// explicitly uses LOCALAPPDATA so the desktop client does not place mutable
	// runtime state in the roaming profile.
	base := ""
	if goruntime.GOOS == "windows" {
		base = os.Getenv("LOCALAPPDATA")
	}
	if base == "" {
		var err error
		base, err = os.UserConfigDir()
		if err != nil {
			return "", err
		}
	}
	dir := filepath.Join(base, "EasyProxy")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func resolveBackendPath() (string, error) {
	if value := os.Getenv("EASYPROXY_SERVER"); value != "" {
		return value, nil
	}
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(executable)
	names := []string{"easyproxy-server"}
	if goruntime.GOOS == "windows" {
		names = []string{"easyproxy-server.exe", "easyproxy-server"}
	}
	for _, name := range names {
		candidates := []string{
			filepath.Join(dir, "resources", name),
			filepath.Join(dir, name),
		}
		for _, candidate := range candidates {
			if info, statErr := os.Stat(candidate); statErr == nil && !info.IsDir() {
				return candidate, nil
			}
		}
	}
	return "", fmt.Errorf("未找到 backend/server，请设置 EASYPROXY_SERVER")
}

func main() {
	app := &App{}
	err := wails.Run(&options.App{
		Title:             "EasyProxy",
		Width:             1200,
		Height:            800,
		MinWidth:          960,
		MinHeight:         640,
		HideWindowOnClose: true,
		Assets:            assets,
		Bind:              []interface{}{app},
		OnStartup:         app.startup,
		OnShutdown:        app.shutdown,
		OnBeforeClose:     app.beforeClose,
	})
	if err != nil {
		log.Fatal(err)
	}
}
