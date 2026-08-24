import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cable,
  Check,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Globe2,
  Layers,
  Network,
  Radio,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { api, MetaInfo, mihomo, ProxyGroup } from "@/lib/api";
import { useMihomoRuntime } from "@/contexts/app-state";
import { formatBytes, formatSpeed, cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function DashboardPage() {
  const qc = useQueryClient();
  const { trafficTotals: totals, traffic, trafficHistory, mode, switchMode, connectionCount } =
    useMihomoRuntime();
  const [nodeDialogOpen, setNodeDialogOpen] = useState(false);
  const [nodeSearch, setNodeSearch] = useState("");
  const [selecting, setSelecting] = useState<string | null>(null);

  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: () => api.get<MetaInfo>("/api/meta"),
    refetchInterval: 10_000,
  });

  const proxies = useQuery({
    queryKey: ["proxies"],
    queryFn: () => mihomo.proxies(),
    refetchInterval: 10_000,
  });

  const groupsQuery = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.get<ProxyGroup[]>("/api/groups"),
  });

  const proxyGroup = proxies.data?.proxies?.["PROXY"];
  const groups = Object.values(proxies.data?.proxies ?? {}).filter(
    (p) => p.all && p.all.length > 0 && p.name !== "PROXY",
  );

  const outletOptions = proxyGroup?.all ?? [];
  const groupOptions = outletOptions.filter(
    (name) => (proxies.data?.proxies?.[name]?.all?.length ?? 0) > 0,
  );
  const nodeOptions = outletOptions.filter(
    (name) => !(proxies.data?.proxies?.[name]?.all?.length ?? 0),
  );
  const selectedNode =
    proxyGroup?.now && nodeOptions.includes(proxyGroup.now) ? proxyGroup.now : "";

  const visibleNodes = useMemo(() => {
    const keyword = nodeSearch.trim().toLocaleLowerCase();
    return keyword
      ? nodeOptions.filter((name) => name.toLocaleLowerCase().includes(keyword))
      : nodeOptions;
  }, [nodeOptions, nodeSearch]);

  const selectProxy = async (name: string) => {
    setSelecting(name);
    try {
      await mihomo.select("PROXY", name);
      await qc.invalidateQueries({ queryKey: ["proxies"] });
      toast.success(`出口已切换为「${name}」`);
      setNodeDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSelecting(null);
    }
  };

  const selectGroupChild = async (groupName: string, targetName: string) => {
    try {
      await mihomo.select(groupName, targetName);
      await qc.invalidateQueries({ queryKey: ["proxies"] });
      toast.success(`分组 [${groupName}] 已切换为「${targetName}」`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const running = meta.data?.core?.state === "running";

  return (
    <div className="space-y-6">
      {/* 顶部指标看板（4大卡片） */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 内核状态 */}
        <Card className="relative overflow-hidden border-border/70 hover:border-primary/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="font-semibold">内核运行状态</CardDescription>
              <div className={cn("p-2 rounded-xl", running ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500")}>
                <Cpu className="h-4 w-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight">
                {running ? "运行正常" : meta.data?.core?.state ?? "未运行"}
              </span>
              <span className={cn("inline-block h-2 w-2 rounded-full", running ? "bg-emerald-500 animate-ping" : "bg-rose-500")} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground font-mono">
              {meta.data?.core?.version ? `Mihomo ${meta.data.core.version}` : "未安装内核"}
            </p>
          </CardContent>
        </Card>

        {/* 实时速率 */}
        <Card className="relative overflow-hidden border-border/70 hover:border-primary/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="font-semibold">当前网络速率</CardDescription>
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <Activity className="h-4 w-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowDown className="h-3 w-3 text-emerald-500" /> 下行
                </div>
                <div className="text-lg font-bold text-emerald-500 font-mono">
                  {formatSpeed(traffic.down)}
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end">
                  <ArrowUp className="h-3 w-3 text-sky-500" /> 上行
                </div>
                <div className="text-lg font-bold text-sky-500 font-mono">
                  {formatSpeed(traffic.up)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 累计流量 */}
        <Card className="relative overflow-hidden border-border/70 hover:border-primary/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="font-semibold">累计传输流量</CardDescription>
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500">
                <Globe2 className="h-4 w-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">总下载</div>
                <div className="text-base font-bold font-mono text-foreground/90">
                  {formatBytes(totals.down)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">总上传</div>
                <div className="text-base font-bold font-mono text-foreground/90">
                  {formatBytes(totals.up)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 活动连接 */}
        <Card className="relative overflow-hidden border-border/70 hover:border-primary/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="font-semibold">活动连接会话</CardDescription>
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
                <Cable className="h-4 w-4" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {connectionCount}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              当前活跃 TCP/UDP 会话数
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 实时流量图表 */}
      <Card className="p-1">
        <CardHeader className="p-5 pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">实时流量监控</CardTitle>
              <CardDescription>最近 40 秒上下行网络传输走势</CardDescription>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">下载: {formatSpeed(traffic.down)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                <span className="text-muted-foreground">上传: {formatSpeed(traffic.up)}</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-3 h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trafficHistory} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="downGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="upGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => formatBytes(v)} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const d = payload[0].payload;
                    return (
                      <div className="rounded-xl border border-border/80 bg-card/95 p-2.5 text-xs shadow-xl backdrop-blur-md">
                        <div className="font-semibold text-muted-foreground mb-1">{d.t}</div>
                        <div className="text-emerald-500 font-mono">↓ {formatSpeed(d.down)}</div>
                        <div className="text-sky-500 font-mono">↑ {formatSpeed(d.up)}</div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area type="monotone" dataKey="down" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#downGrad)" />
              <Area type="monotone" dataKey="up" stroke="#0ea5e9" strokeWidth={2} fillOpacity={1} fill="url(#upGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 主出口 PROXY 切换面板 */}
      {proxyGroup && (
        <Card className="border-primary/20 bg-gradient-to-b from-primary/5 via-card/80 to-card">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">主代理出口（PROXY）</CardTitle>
                  <Badge variant="purple" className="text-xs">
                    当前使用: {proxyGroup.now ?? "-"}
                  </Badge>
                </div>
                <CardDescription className="mt-1">
                  控制默认分流出口。支持快速切换到地区策略组或单个指定节点。
                </CardDescription>
              </div>

              {nodeOptions.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setNodeDialogOpen(true)}
                  className="shrink-0"
                >
                  <Server className="h-3.5 w-3.5" />
                  从全量节点自选 ({nodeOptions.length})
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2.5">
              {groupOptions.map((name) => {
                const p = proxies.data?.proxies?.[name];
                const active = proxyGroup.now === name;
                return (
                  <button
                    key={name}
                    disabled={selecting === name}
                    onClick={() => selectProxy(name)}
                    className={cn(
                      "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all duration-200 cursor-pointer select-none",
                      active
                        ? "bg-primary text-primary-foreground border-primary shadow-glow shadow-primary/25 scale-[1.02]"
                        : "bg-background/70 border-border/70 text-foreground/85 hover:border-primary/40 hover:bg-accent/60"
                    )}
                  >
                    <Layers className={cn("h-3.5 w-3.5", active ? "text-primary-foreground" : "text-primary")} />
                    <span>{name}</span>
                    {p?.now && (
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md font-mono", active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground")}>
                        {p.now}
                      </span>
                    )}
                    {active && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                  </button>
                );
              })}

              {selectedNode && (
                <button
                  disabled
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground border border-primary shadow-glow shadow-primary/25"
                >
                  <Server className="h-3.5 w-3.5" />
                  <span>指定单节点: {selectedNode}</span>
                  <Check className="h-3.5 w-3.5 stroke-[3]" />
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 策略分组卡片矩阵 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold tracking-tight text-foreground/90 flex items-center gap-2">
            <Radio className="h-4.5 w-4.5 text-primary" />
            所有策略组状态
          </h2>
          <span className="text-xs text-muted-foreground">
            共 {groups.length} 个活跃分组
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => {
            return (
              <Card key={group.name} className="flex flex-col justify-between hover:border-primary/30 transition-all">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold truncate">
                      {group.name}
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] uppercase font-mono">
                      {group.type}
                    </Badge>
                  </div>
                  <CardDescription className="truncate font-mono text-primary font-medium text-xs">
                    当前: {group.now || "-"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                    {(group.all ?? []).map((subItem) => {
                      const active = group.now === subItem;
                      return (
                        <button
                          key={subItem}
                          onClick={() => selectGroupChild(group.name, subItem)}
                          className={cn(
                            "px-2.5 py-1 text-[11px] rounded-lg border transition-all text-left truncate max-w-full font-medium",
                            active
                              ? "bg-primary/15 text-primary border-primary/30 font-semibold"
                              : "bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent"
                          )}
                        >
                          {subItem}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* 选择单节点 Dialog */}
      <Dialog open={nodeDialogOpen} onOpenChange={setNodeDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>选择单节点直出 (PROXY)</DialogTitle>
            <DialogDescription>
              从全量代理节点中直接挑选作为 PROXY 出口
            </DialogDescription>
          </DialogHeader>

          <div className="relative my-2">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索节点名称 / 关键词…"
              value={nodeSearch}
              onChange={(e) => setNodeSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 max-h-96">
            {visibleNodes.map((nName) => {
              const active = proxyGroup?.now === nName;
              return (
                <div
                  key={nName}
                  onClick={() => selectProxy(nName)}
                  className={cn(
                    "flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all",
                    active
                      ? "bg-primary/10 border-primary text-primary font-semibold"
                      : "bg-card hover:bg-accent/60 border-border/60 text-foreground/85"
                  )}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-xs truncate">{nName}</span>
                  </div>
                  {active && <Check className="h-4 w-4 text-primary shrink-0" />}
                </div>
              );
            })}
            {visibleNodes.length === 0 && (
              <div className="text-center py-8 text-xs text-muted-foreground">
                未找到匹配的节点
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
