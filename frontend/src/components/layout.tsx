import { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cable,
  ChevronLeft,
  Cpu,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Network,
  RefreshCw,
  ScrollText,
  Server,
  Settings,
  Sun,
  Terminal,
  X,
  Sparkles,
  Wrench,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { toast } from "sonner";
import { api, MetaInfo } from "@/lib/api";
import {
  type MihomoMode,
  type Theme,
  useMihomoRuntime,
  useTheme,
} from "@/contexts/app-state";
import { useUpdate } from "@/contexts/update-state";
import { UpdateDialog } from "@/components/update-dialog";
import { PendingConfigDialog } from "@/components/pending-config-dialog";
import { useConfigApply } from "@/contexts/config-apply-state";
import { cn, formatSpeed } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LanguageToggle } from "@/components/language-toggle";
import { defineMessages, useMessages } from "@/contexts/language";

const nav = [
  { to: "/", label: "dashboard", icon: LayoutDashboard },
  { to: "/nodes", label: "nodes", icon: Server },
  { to: "/rules", label: "rules", icon: ScrollText },
  { to: "/connections", label: "connections", icon: Cable },
  { to: "/kernel", label: "kernel", icon: Cpu },
  { to: "/geo", label: "geo", icon: Globe2 },
  { to: "/tun", label: "tun", icon: Network },
  { to: "/logs", label: "logs", icon: Terminal },
  { to: "/settings", label: "settings", icon: Settings },
] as const;

const modes: { key: MihomoMode; label: "modeRule" | "modeGlobal" | "modeDirect" }[] = [
  { key: "rule", label: "modeRule" },
  { key: "global", label: "modeGlobal" },
  { key: "direct", label: "modeDirect" },
];

const SIDEBAR_STORAGE_KEY = "easyproxy-sidebar-collapsed";

const themes: { key: Theme; label: "themeLight" | "themeDark" | "themeSystem"; icon: typeof Sun }[] = [
  { key: "light", label: "themeLight", icon: Sun },
  { key: "dark", label: "themeDark", icon: Moon },
  { key: "system", label: "themeSystem", icon: Monitor },
];

const messages = defineMessages({
  dashboard: "仪表盘", nodes: "节点池", rules: "规则集", connections: "连接监控", kernel: "内核管理",
  geo: "Geo 数据", tun: "透明代理", logs: "实时日志", settings: "系统设置",
  coreRunning: "正常运行", coreError: "异常", coreStopped: "已停止", core: "内核", coreStatus: "内核状态",
  logout: "退出登录", logoutSuccess: "已退出登录", modeRule: "规则", modeGlobal: "全局", modeDirect: "直连",
  themeLight: "明亮", themeDark: "深暗", themeSystem: "自动", pendingConfig: "待应用配置",
  newVersion: "发现新版本", currentTheme: "当前主题", clickToSwitch: "单击切换",
}, {
  dashboard: "Dashboard", nodes: "Nodes", rules: "Rules", connections: "Connections", kernel: "Kernel",
  geo: "Geo Data", tun: "Transparent Proxy", logs: "Logs", settings: "Settings",
  coreRunning: "Running", coreError: "Error", coreStopped: "Stopped", core: "Kernel", coreStatus: "Kernel Status",
  logout: "Sign Out", logoutSuccess: "Signed out", modeRule: "Rule", modeGlobal: "Global", modeDirect: "Direct",
  themeLight: "Light", themeDark: "Dark", themeSystem: "System", pendingConfig: "Pending Changes",
  newVersion: "Update Available", currentTheme: "Current theme", clickToSwitch: "click to switch",
});

interface SidebarContentProps {
  collapsed: boolean;
  coreState: string;
  version: string;
  onLogout: () => void;
  onNavigate?: () => void;
}

function SidebarContent({ collapsed, coreState, version, onLogout, onNavigate }: SidebarContentProps) {
  const text = useMessages(messages);
  const running = coreState === "running";
  const coreLabel = running ? text.coreRunning : coreState === "failed" ? text.coreError : text.coreStopped;
  const displayVersion = version ? (version.startsWith("v") ? version : `v${version}`) : "v…";

  return (
    <div className="flex flex-col h-full">
      {/* 品牌区 */}
      <div className="flex h-16 items-center gap-3 border-b border-border/60 px-4">
        <img src="/easyproxy-logo.svg" alt="EasyProxy" className="h-10 w-10 shrink-0 rounded-2xl shadow-md shadow-primary/25" />
        <div className={cn("flex min-w-0 flex-col overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out", collapsed ? "delay-100 max-w-0 -translate-x-2 opacity-0" : "delay-0 max-w-32 translate-x-0 opacity-100")}>
          <span className="font-bold text-base tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            EasyProxy
          </span>
          <span className="text-[11px] text-muted-foreground font-mono font-medium">{displayVersion}</span>
        </div>
      </div>

      {/* 导航项 */}
      <nav className="flex-1 space-y-1.5 p-3 overflow-y-auto">
        {nav.map((item) => {
          const label = text[item.label];
          return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            title={collapsed ? label : undefined}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "group relative flex h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-medium transition-colors duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )
            }
          >
            <item.icon className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <div className={cn("flex min-w-0 flex-col overflow-hidden whitespace-nowrap text-left transition-[max-width,opacity,transform] duration-200 ease-out", collapsed ? "delay-100 max-w-0 -translate-x-2 opacity-0" : "delay-0 max-w-32 translate-x-0 opacity-100")}>
              <span className="leading-tight">{label}</span>
            </div>
          </NavLink>
          );
        })}
      </nav>

      {/* 底部内核运行状态与退出 */}
      <div className="border-t border-border/60 bg-muted/20 p-3">
        <div className="space-y-3">
          <div className="relative flex h-11 w-full items-center rounded-xl border border-border/50 bg-card px-3 shadow-xs">
            <div className={cn("absolute top-1/2 flex -translate-y-1/2 items-center transition-[left,transform] duration-300 ease-in-out", collapsed ? "left-1/2 -translate-x-1/2" : "left-3 translate-x-0")}>
              <div className={cn("h-2.5 w-2.5 shrink-0 rounded-full", running ? "bg-emerald-500 animate-pulse" : "bg-rose-500")} title={`${text.core}: ${coreLabel}`} />
              <span className={cn("overflow-hidden whitespace-nowrap text-xs font-medium text-muted-foreground transition-[max-width,margin,opacity,transform] duration-200 ease-out", collapsed ? "delay-100 ml-0 max-w-0 -translate-x-2 opacity-0" : "ml-2 max-w-20 translate-x-0 opacity-100")}>{text.coreStatus}</span>
            </div>
            <Badge variant={running ? "success" : "destructive"} className={cn("absolute right-3 top-1/2 -translate-y-1/2 overflow-hidden text-[10px] transition-[max-width,padding,opacity] duration-200 ease-out", collapsed ? "delay-100 max-w-0 border-0 px-0 py-0 opacity-0" : "max-w-20 px-2 py-0 opacity-100")}>
              {coreLabel}
            </Badge>
          </div>
          <button
            onClick={onLogout}
            title={collapsed ? text.logout : undefined}
            className="flex h-11 w-full items-center justify-center rounded-xl border border-border/50 bg-card px-3 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className={cn("overflow-hidden whitespace-nowrap transition-[max-width,margin,opacity,transform] duration-200 ease-out", collapsed ? "delay-100 ml-0 max-w-0 -translate-x-2 opacity-0" : "ml-2 max-w-20 translate-x-0 opacity-100")}>{text.logout}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const text = useMessages(messages);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { traffic, mode, modePending, switchMode } = useMihomoRuntime();
  const { checkData, setDialogOpen: setUpdateDialogOpen } = useUpdate();
  const { pending, setDialogOpen: setConfigDialogOpen } = useConfigApply();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  };

  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: () => api.get<MetaInfo>("/api/meta"),
    refetchInterval: 15_000,
  });

  const logout = async () => {
    try {
      await api.post("/api/logout");
      toast.success(text.logoutSuccess);
      qc.clear();
      navigate("/");
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const cycleTheme = () => {
    const current = themes.findIndex((item) => item.key === theme);
    const next = themes[(current + 1) % themes.length];
    setTheme(next.key);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* 桌面端侧边栏 */}
      <aside
        className={cn(
          "relative z-30 hidden shrink-0 flex-col overflow-visible transition-[width] duration-300 ease-in-out md:flex",
          collapsed ? "w-[4.5rem]" : "w-60"
        )}
      >
        <div className="flex h-full min-w-0 flex-col overflow-hidden border-r border-border/60 bg-card/60 backdrop-blur-xl">
          <SidebarContent
            collapsed={collapsed}
            coreState={meta.data?.core?.state ?? "unknown"}
            version={meta.data?.version ?? ""}
            onLogout={logout}
          />
        </div>

        {/* 折叠切换按钮 */}
        <button
          onClick={toggleCollapsed}
          className="absolute -right-3.5 top-[50px] z-40 flex h-7 w-7 items-center justify-center rounded-full border border-border/80 bg-card text-muted-foreground shadow-md transition-[transform,background-color] duration-200 hover:scale-105 hover:bg-accent active:scale-95"
        >
          <ChevronLeft className={cn("h-3.5 w-3.5 transition-transform duration-300 ease-in-out", collapsed && "rotate-180")} />
        </button>
      </aside>

      {/* 移动端侧边抽屉 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-64 max-w-[80vw] bg-card border-r border-border h-full z-10 shadow-2xl animate-in slide-in-from-left duration-200">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3.5 top-5 p-1.5 rounded-xl text-muted-foreground hover:bg-accent"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent
              collapsed={false}
              coreState={meta.data?.core?.state ?? "unknown"}
              version={meta.data?.version ?? ""}
              onLogout={logout}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* 右侧主内容区 */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-background">
        {/* 顶部 Header */}
        <header className="h-16 border-b border-border/60 bg-card/40 backdrop-blur-xl px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 rounded-xl border border-border hover:bg-accent text-muted-foreground"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* 模式快速切换 Pill */}
            <div className="flex items-center bg-muted/60 p-1 rounded-xl border border-border/40 backdrop-blur-sm">
              {modes.map((m) => {
                const active = mode === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => switchMode(m.key)}
                    disabled={modePending}
                    className={cn(
                      "px-3 py-1 text-xs font-semibold rounded-lg transition-all duration-150 select-none",
                      active
                        ? "bg-card text-foreground shadow-xs shadow-black/5 font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {text[m.label]}
                  </button>
                );
              })}
            </div>

            {/* 实时网速胶囊 */}
            <div className="hidden sm:flex items-center gap-3.5 px-3 py-1.5 rounded-xl bg-card border border-border/60 shadow-2xs text-xs font-mono font-medium">
              <div className="flex items-center gap-1 text-emerald-500">
                <ArrowDown className="h-3.5 w-3.5" />
                <span>{formatSpeed(traffic.down)}</span>
              </div>
              <div className="w-[1px] h-3 bg-border" />
              <div className="flex items-center gap-1 text-sky-500">
                <ArrowUp className="h-3.5 w-3.5" />
                <span>{formatSpeed(traffic.up)}</span>
              </div>
            </div>
          </div>

          {/* 右侧：更新提示 + 主题切换 */}
          <div className="flex items-center gap-3">
            {(pending?.count ?? 0) > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-amber-500/30 bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                onClick={() => setConfigDialogOpen(true)}
              >
                <Wrench className="h-3.5 w-3.5" />
                <span className="hidden md:inline">{text.pendingConfig}</span>
                <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px]">{pending?.count}</span>
              </Button>
            )}
            {/* 升级提示按钮 */}
            {checkData?.has_update && (
              <Button
                variant="gradient"
                size="sm"
                className="h-8 text-xs font-semibold px-2.5"
                onClick={() => setUpdateDialogOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5 animate-bounce" />
                <span className="hidden md:inline">{text.newVersion}</span>
              </Button>
            )}

            <LanguageToggle />

            <button
              onClick={cycleTheme}
              title={`${text.currentTheme}: ${text[themes.find((item) => item.key === theme)?.label ?? "themeSystem"]}; ${text.clickToSwitch}`}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/80 bg-card/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shadow-2xs"
            >
              {theme === "light" ? (
                <Sun className="h-4 w-4 text-amber-500" />
              ) : theme === "dark" ? (
                <Moon className="h-4 w-4 text-primary" />
              ) : (
                <Monitor className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>

      <UpdateDialog />
      <PendingConfigDialog />
    </div>
  );
}
