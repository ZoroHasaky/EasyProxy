import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { api, MetaInfo, mihomo } from "@/lib/api";
import { useMihomoRuntime } from "@/contexts/app-state";
import { formatBytes } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const qc = useQueryClient();
  const { trafficTotals: totals } = useMihomoRuntime();
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
    refetchInterval: 15_000,
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
  const selectedNode = proxyGroup?.now && nodeOptions.includes(proxyGroup.now) ? proxyGroup.now : "";
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
      toast.success(`出口已切换到 ${name}`);
      setNodeDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSelecting(null);
    }
  };

  const running = meta.data?.core?.state === "running";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <CardHeader className="pb-2"><CardDescription>累计流量</CardDescription></CardHeader>
          <CardContent className="text-sm">
            <div className="text-emerald-500">↓ {formatBytes(totals.down)}</div>
            <div className="text-sky-500">↑ {formatBytes(totals.up)}</div>
          </CardContent>
        </Card>
      </div>

      {proxyGroup && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>出口切换（PROXY）</CardTitle>
            <CardDescription>当前：{proxyGroup.now ?? "-"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {groupOptions.map((name) => {
              const p = proxies.data?.proxies?.[name];
              const active = proxyGroup.now === name;
              return (
                <button
                  key={name}
                  onClick={() => selectProxy(name)}
                  disabled={selecting !== null}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-50",
                    active ? "border-emerald-600 bg-emerald-600/15 text-emerald-400" : "border-border",
                  )}
                >
                  {name}
                  {p?.alive && <span className="ml-1 text-emerald-500">●</span>}
                </button>
              );
            })}
            {selectedNode && (
              <div className="flex items-center rounded-md border border-emerald-600 bg-emerald-600/15 px-3 py-1.5 text-xs text-emerald-500">
                <span className="mr-1 text-muted-foreground">当前节点：</span>
                {selectedNode}
                {proxies.data?.proxies?.[selectedNode]?.alive && <span className="ml-1">●</span>}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => setNodeDialogOpen(true)}>
              选择具体节点
            </Button>
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

      <Dialog
        open={nodeDialogOpen}
        onOpenChange={(open) => {
          setNodeDialogOpen(open);
          if (!open) setNodeSearch("");
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>选择出口节点</DialogTitle>
            <DialogDescription>这里只显示当前 PROXY 出口可选择的具体节点。</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={nodeSearch}
              onChange={(event) => setNodeSearch(event.target.value)}
              placeholder="搜索节点名称"
              className="pl-9"
            />
          </div>
          <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
            {visibleNodes.map((name) => {
              const node = proxies.data?.proxies?.[name];
              const active = proxyGroup?.now === name;
              const latestDelay = node?.history?.length
                ? node.history[node.history.length - 1].delay
                : 0;
              return (
                <button
                  key={name}
                  onClick={() => selectProxy(name)}
                  disabled={selecting !== null}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50",
                    active && "border-emerald-600 bg-emerald-600/10",
                  )}
                >
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      node?.alive ? "bg-emerald-500" : "bg-red-500",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {latestDelay ? (
                    <span className="text-xs text-muted-foreground">{latestDelay} ms</span>
                  ) : null}
                  {active && <Badge variant="secondary">当前</Badge>}
                </button>
              );
            })}
            {visibleNodes.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {nodeSearch ? "没有匹配的节点" : "当前没有可选择的具体节点"}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
