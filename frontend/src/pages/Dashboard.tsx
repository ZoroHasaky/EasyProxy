import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  Layers,
  Radio,
  Search,
  Server,
  Zap,
} from "lucide-react";
import { api, mihomo, MihomoProxy, proxyGroupTypeLabel, ProxyGroup } from "@/lib/api";
import { cn } from "@/lib/utils";
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

function activeLeafNode(proxies: Record<string, MihomoProxy>, name?: string): string {
  const visited = new Set<string>();
  let current = name ?? "";
  while (current && !visited.has(current)) {
    visited.add(current);
    const proxy = proxies[current];
    if (!proxy?.now || proxy.now === current) return current;
    current = proxy.now;
  }
  return current;
}

function latestDelay(proxy?: MihomoProxy): number | null {
  const history = proxy?.history;
  if (!history?.length) return null;
  const delay = history[history.length - 1]?.delay;
  return typeof delay === "number" && delay > 0 ? delay : null;
}

export default function DashboardPage() {
  const qc = useQueryClient();
  const [nodeDialogOpen, setNodeDialogOpen] = useState(false);
  const [nodeSearch, setNodeSearch] = useState("");
  const [selecting, setSelecting] = useState<string | null>(null);

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
  const currentNode = activeLeafNode(proxies.data?.proxies ?? {}, proxyGroup?.now);
  const currentNodeDelay = latestDelay(proxies.data?.proxies?.[currentNode]);

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

  return (
    <div className="space-y-6">
      {/* 主出口 PROXY 切换面板 */}
      {proxyGroup && (
        <Card className="border-primary/20 bg-gradient-to-b from-primary/5 via-card/80 to-card">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">主代理出口</CardTitle>
                  <Badge variant="purple" className="text-xs">
                    当前使用: {proxyGroup.now ?? "-"}
                  </Badge>
                  {currentNode && (
                    <Badge variant="outline" className="gap-1 text-xs font-mono">
                      <Zap className="h-3 w-3 text-primary" />
                      当前节点: {currentNode} · {currentNodeDelay === null ? "未测速" : `${currentNodeDelay} ms`}
                    </Badge>
                  )}
                </div>
                <CardDescription className="mt-1">
                  控制默认分流出口。支持快速切换到地区节点组合或单个指定节点。
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
            所有节点组合状态
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
                      {proxyGroupTypeLabel(group.type)}
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
            <DialogTitle>选择单节点直出</DialogTitle>
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
