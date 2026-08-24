import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cable,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Network,
  RefreshCw,
  ScrollText,
  Server,
  Settings,
  Sun,
  Terminal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, MetaInfo } from "@/lib/api";
import {
  type MihomoMode,
  useMihomoRuntime,
  useTheme,
} from "@/contexts/app-state";
import { cn, formatSpeed } from "@/lib/utils";

const nav = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard },
  { to: "/nodes", label: "节点", icon: Server },
  { to: "/rules", label: "规则", icon: ScrollText },
  { to: "/connections", label: "连接", icon: Cable },
  { to: "/kernel", label: "内核", icon: Cpu },
  { to: "/tun", label: "透明代理", icon: Network },
  { to: "/logs", label: "日志", icon: Terminal },
  { to: "/settings", label: "设置", icon: Settings },
  { to: "/about", label: "关于", icon: Info },
];

const modes: { key: MihomoMode; label: string }[] = [
  { key: "rule", label: "规则" },
  { key: "global", label: "全局" },
  { key: "direct", label: "直连" },
];

const SIDEBAR_STORAGE_KEY = "easyproxy-sidebar-collapsed";

interface SidebarProps {
  collapsed: boolean;
  coreState: string;
  onLogout: () => void;
  onNavigate?: () => void;
}

function Sidebar({ collapsed, coreState, onLogout, onNavigate }: SidebarProps) {
  const running = coreState === "running";
  const coreLabel = running ? "运行中" : coreState === "failed" ? "异常" : "未运行";

  return (
    <>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            title={collapsed ? item.label : undefined}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex h-10 items-center rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                collapsed ? "justify-center px-0" : "gap-2.5 px-3",
                isActive && "bg-accent font-medium text-accent-foreground",
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className={cn("border-t text-xs text-muted-foreground", collapsed ? "p-2" : "p-3")}>
        <div
          className={cn("flex items-center", collapsed ? "h-8 justify-center" : "gap-2")}
          title={collapsed ? `内核${coreLabel}` : undefined}
        >
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              running
                ? "animate-pulse bg-emerald-500"
                : coreState === "failed"
                  ? "bg-red-500"
                  : "bg-zinc-500",
            )}
          />
          {!collapsed && <>内核{coreLabel}</>}
        </div>
        <button
          onClick={onLogout}
          title={collapsed ? "退出登录" : undefined}
          className={cn(
            "flex h-8 items-center rounded-md hover:bg-accent hover:text-foreground",
            collapsed ? "w-full justify-center" : "mt-1 gap-2 px-1",
          )}
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && "退出登录"}
        </button>
      </div>
    </>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const { traffic, trafficConnected, mode, modePending, switchMode } = useMihomoRuntime();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: () => api.get<MetaInfo>("/api/meta"),
    refetchInterval: 10_000,
  });
  const coreState = meta.data?.core?.state ?? "unknown";

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  };

  const logout = async () => {
    await api.post("/api/logout");
    qc.clear();
    toast.success("已退出登录");
    navigate("/");
    location.reload();
  };

  return (
    <div
      className={cn(
        "grid h-screen min-h-0 grid-cols-1 grid-rows-[4rem_minmax(0,1fr)] bg-background transition-[grid-template-columns] duration-200",
        collapsed
          ? "md:grid-cols-[5rem_minmax(0,1fr)]"
          : "md:grid-cols-[13rem_minmax(0,1fr)]",
      )}
    >
      <div className="relative hidden items-center border-b border-r bg-card px-3 md:flex">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
          ez
        </div>
        {!collapsed && (
          <div className="ml-2 min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">EasyProxy</div>
            <div className="text-[11px] text-muted-foreground">v{meta.data?.version ?? "…"}</div>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className={cn(
            "ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground",
            collapsed && "absolute -right-4 z-30 border bg-card shadow-sm",
          )}
          title={collapsed ? "展开导航" : "收起导航"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <header className="z-20 flex min-w-0 items-center border-b bg-card px-2 sm:px-4 md:col-start-2 md:row-start-1">
        <div className="flex items-center gap-2 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
            title="打开导航"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-xs font-bold text-white">
            ez
          </div>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-3">
          <div
            className="flex min-w-[4.5rem] flex-col items-end text-[10px] leading-tight sm:min-w-0 sm:flex-row sm:items-center sm:gap-2 sm:text-xs"
            title={trafficConnected ? "实时速率" : "等待内核流量数据"}
          >
            <span className={cn("text-emerald-500", !trafficConnected && "text-muted-foreground")}>
              ↓ {trafficConnected ? formatSpeed(traffic.down) : "--"}
            </span>
            <span className={cn("text-sky-500", !trafficConnected && "text-muted-foreground")}>
              ↑ {trafficConnected ? formatSpeed(traffic.up) : "--"}
            </span>
          </div>

          <div className="flex rounded-md border bg-background p-0.5">
            {modes.map((item) => (
              <button
                key={item.key}
                onClick={() => switchMode(item.key)}
                disabled={modePending}
                className={cn(
                  "h-7 rounded px-2 text-[11px] font-medium transition-colors disabled:opacity-50 sm:px-3 sm:text-xs",
                  mode === item.key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            onClick={toggleTheme}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title={theme === "dark" ? "切换到浅色" : "切换到深色"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <aside className="hidden min-h-0 flex-col border-r bg-card md:col-start-1 md:row-start-2 md:flex">
        <Sidebar collapsed={collapsed} coreState={coreState} onLogout={logout} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-label="关闭导航"
          />
          <aside className="relative flex h-full w-64 flex-col border-r bg-card shadow-xl">
            <div className="flex h-16 items-center border-b px-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
                ez
              </div>
              <div className="ml-2">
                <div className="text-sm font-semibold leading-tight">EasyProxy</div>
                <div className="text-[11px] text-muted-foreground">v{meta.data?.version ?? "…"}</div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
                title="关闭导航"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <Sidebar
              collapsed={false}
              coreState={coreState}
              onLogout={logout}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      <main className="min-w-0 overflow-y-auto md:col-start-2 md:row-start-2">
        <div className="mx-auto max-w-6xl p-4 sm:p-6">{children}</div>
      </main>

      <button
        onClick={() => {
          qc.invalidateQueries();
          toast.success("已刷新");
        }}
        className="fixed bottom-5 right-5 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-lg hover:bg-accent"
        title="刷新数据"
      >
        <RefreshCw className="h-4 w-4" />
      </button>
    </div>
  );
}
