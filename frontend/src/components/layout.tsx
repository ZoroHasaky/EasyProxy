import { NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard, Rss, Server, ScrollText, Layers, Cable, Rocket,
  Terminal, Settings, Info, LogOut, RefreshCw,
} from "lucide-react";
import { api, MetaInfo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const nav = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard },
  { to: "/subscriptions", label: "订阅", icon: Rss },
  { to: "/nodes", label: "节点池", icon: Server },
  { to: "/rules", label: "规则", icon: ScrollText },
  { to: "/groups", label: "策略组", icon: Layers },
  { to: "/connections", label: "连接", icon: Cable },
  { to: "/deploy", label: "部署", icon: Rocket },
  { to: "/logs", label: "日志", icon: Terminal },
  { to: "/settings", label: "设置", icon: Settings },
  { to: "/about", label: "关于", icon: Info },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: () => api.get<MetaInfo>("/api/meta"),
    refetchInterval: 10_000,
  });
  const coreState = meta.data?.core?.state ?? "unknown";
  const running = coreState === "running";

  const logout = async () => {
    await api.post("/api/logout");
    qc.clear();
    toast.success("已退出登录");
    navigate("/");
    location.reload();
  };

  return (
    <div className="flex h-screen bg-background">
      <aside className="flex w-52 shrink-0 flex-col border-r bg-card">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
            ez
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">ezproxy</div>
            <div className="text-[11px] text-muted-foreground">v{meta.data?.version ?? "…"}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-accent text-accent-foreground font-medium",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                running ? "bg-emerald-500 animate-pulse" : coreState === "failed" ? "bg-red-500" : "bg-zinc-500",
              )}
            />
            内核{running ? "运行中" : coreState === "failed" ? "异常" : "未运行"}
          </div>
          <button
            onClick={logout}
            className="mt-2 flex items-center gap-2 rounded-md px-1 py-1 hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" /> 退出登录
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6">{children}</div>
      </main>
      <button
        onClick={() => {
          qc.invalidateQueries();
          toast.success("已刷新");
        }}
        className="fixed bottom-5 right-5 flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-lg hover:bg-accent"
        title="刷新数据"
      >
        <RefreshCw className="h-4 w-4" />
      </button>
    </div>
  );
}
