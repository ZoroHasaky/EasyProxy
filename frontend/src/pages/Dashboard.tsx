import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Area, AreaChart, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { api, MetaInfo, MihomoProxiesResp, mihomo } from "@/lib/api";
import { openStream } from "@/lib/ws";
import { type MihomoMode, useMihomoRuntime } from "@/contexts/app-state";
import { formatSpeed, formatBytes } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MODES: { key: MihomoMode; label: string }[] = [
  { key: "rule", label: "规则" },
  { key: "global", label: "全局" },
  { key: "direct", label: "直连" },
];

export default function DashboardPage() {
  const qc = useQueryClient();
  const { traffic, trafficHistory: history, mode, modePending, switchMode } = useMihomoRuntime();
  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: () => api.get<MetaInfo>("/api/meta"),
    refetchInterval: 10_000,
  });
  const proxies = useQuery({
    queryKey: ["proxies"],
    queryFn: () => mihomo.proxies(),
    refetchInterval: 15_000,
  });

  const [connCount, setConnCount] = useState(0);
  const [totals, setTotals] = useState({ up: 0, down: 0 });

  useEffect(() => {
    return openStream("/api/ws/connections", (data) => {
      try {
        const p = JSON.parse(data);
        setConnCount(p.connections ? p.connections.length : 0);
        setTotals({ up: p.uploadTotal, down: p.downloadTotal });
      } catch { /* ignore */ }
    });
  }, []);

  const proxyGroup = proxies.data?.proxies?.["PROXY"];
  const groups = Object.values(proxies.data?.proxies ?? {}).filter(
    (p) => p.all && p.all.length > 0 && p.name !== "PROXY",
  );

  const selectProxy = async (name: string) => {
    try {
      await mihomo.select("PROXY", name);
      qc.invalidateQueries({ queryKey: ["proxies"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const running = meta.data?.core?.state === "running";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>内核状态</CardDescription></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className={cn("h-3 w-3 rounded-full", running ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
              <span className="text-lg font-semibold">{running ? "运行中" : meta.data?.core?.state ?? "未知"}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {meta.data?.core?.version || "内核未安装"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>实时速率</CardDescription></CardHeader>
          <CardContent className="text-sm">
            <div className="text-emerald-500">↓ {formatSpeed(traffic.down)}</div>
            <div className="text-sky-500">↑ {formatSpeed(traffic.up)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>活跃连接</CardDescription></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{connCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>累计流量</CardDescription></CardHeader>
          <CardContent className="text-sm">
            <div className="text-emerald-500">↓ {formatBytes(totals.down)}</div>
            <div className="text-sky-500">↑ {formatBytes(totals.up)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle>流量</CardTitle>
          <div className="flex gap-1">
            {MODES.map((m) => (
              <Button
                key={m.key}
                size="sm"
                variant={mode === m.key ? "default" : "outline"}
                onClick={() => switchMode(m.key)}
                disabled={modePending}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="down" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="up" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide />
              <Tooltip
                formatter={(v: any, name: any) => [formatSpeed(Number(v)), name === "down" ? "下载" : "上传"]}
                contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 }}
              />
              <Area type="monotone" dataKey="down" stroke="#10b981" fill="url(#down)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="up" stroke="#0ea5e9" fill="url(#up)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {proxyGroup && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>出口切换（PROXY）</CardTitle>
            <CardDescription>当前：{proxyGroup.now ?? "-"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(proxyGroup.all ?? []).map((name) => {
              const p = proxies.data?.proxies?.[name];
              const active = proxyGroup.now === name;
              return (
                <button
                  key={name}
                  onClick={() => selectProxy(name)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent",
                    active ? "border-emerald-600 bg-emerald-600/15 text-emerald-400" : "border-border",
                  )}
                >
                  {name}
                  {p?.alive && <span className="ml-1 text-emerald-500">●</span>}
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {groups.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>策略组概览</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {groups.slice(0, 8).map((g) => (
              <div key={g.name} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <span className="font-medium">{g.name}</span>
                <Badge variant="secondary">{g.now ?? "-"}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
