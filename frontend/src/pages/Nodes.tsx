import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  CheckCircle2,
  Clock,
  Download,
  Eraser,
  Filter,
  Gauge,
  Layers,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Zap,
} from "lucide-react";
import { api, ProxyNode, RegionInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SubscriptionsPanel } from "@/pages/Subscriptions";
import { cn } from "@/lib/utils";

function LatencyBadge({ node }: { node: ProxyNode }) {
  if (!node.latency_at) return <span className="text-muted-foreground text-xs font-mono">未测速</span>;
  if (!node.alive || node.latency === 0) return <Badge variant="destructive">超时</Badge>;
  const variant = node.latency < 200 ? "success" : node.latency < 600 ? "warning" : "secondary";
  return (
    <Badge variant={variant as any} className="font-mono text-[11px]">
      <Zap className="h-2.5 w-2.5" />
      {node.latency} ms
    </Badge>
  );
}

export function NodesPanel({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const [region, setRegion] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [enabled, setEnabled] = useState("");
  const [sort, setSort] = useState("id");

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [delayPending, setDelayPending] = useState<number | null>(null);
  const [editingNode, setEditingNode] = useState<ProxyNode | null>(null);
  const [editingName, setEditingName] = useState("");

  const params = new URLSearchParams();
  if (region) params.set("region", region);
  if (source) params.set("source", source);
  if (q) params.set("q", q);
  if (enabled) params.set("enabled", enabled);

  const nodes = useQuery({
    queryKey: ["nodes", region, source, q, enabled],
    queryFn: () => api.get<ProxyNode[]>(`/api/nodes?${params.toString()}`),
  });

  const regions = useQuery({
    queryKey: ["nodeRegions"],
    queryFn: () => api.get<RegionInfo[]>("/api/nodes/regions"),
  });

  const checkMutation = useMutation({
    mutationFn: () =>
      api.post<{ tested: number }>("/api/nodes/check", {
        ids: (nodes.data ?? []).filter((node) => node.enabled).map((node) => node.id),
      }),
    onSuccess: (res) => {
      toast.success(`测速完成，共测试 ${res.tested} 个节点`);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    },
    onError: (e: any) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) =>
      api.patch(`/api/nodes/${id}`, { enabled: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nodes"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => api.del(`/api/nodes/${id}`),
    onSuccess: () => {
      toast.success("节点已删除");
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
  });

  const editMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/nodes/${editingNode!.id}`, { name: editingName.trim() }),
    onSuccess: () => {
      toast.success("节点名称已更新");
      setEditingNode(null);
      setEditingName("");
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const pruneMutation = useMutation({
    mutationFn: () => api.post<{ removed: number }>("/api/nodes/prune"),
    onSuccess: (res) => {
      toast.success(`已清理 ${res.removed} 个失效不可用节点`);
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const testOne = async (id: number) => {
    setDelayPending(id);
    try {
      const res = await api.get<{ delay: number }>(`/api/nodes/${id}/delay`);
      toast.success(`测速成功：${res.delay} ms`);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    } catch (e: any) {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    } finally {
      setDelayPending(null);
    }
  };

  const importMutation = useMutation({
    mutationFn: () => api.post<{ added: number }>("/api/nodes/import", { content: importText }),
    onSuccess: (res) => {
      toast.success(`导入成功，新增 ${res.added} 个节点`);
      setImportOpen(false);
      setImportText("");
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rawList = nodes.data ?? [];
  const sortedList = [...rawList].sort((a, b) => {
    if (sort === "latency") {
      const la = a.alive && a.latency > 0 ? a.latency : 999999;
      const lb = b.alive && b.latency > 0 ? b.latency : 999999;
      return la - lb;
    }
    if (sort === "name") return a.name.localeCompare(b.name);
    return a.id - b.id;
  });

  return (
    <div className="space-y-4">
      {/* 筛选与操作栏 */}
      <div className="flex flex-col gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            <h3 className="font-bold text-base tracking-tight">节点池总览</h3>
            <Badge variant="secondary" className="font-mono text-xs">
              {rawList.length} 个节点
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending || rawList.length === 0}
            >
              <Gauge className={cn("h-3.5 w-3.5", checkMutation.isPending && "animate-spin")} />
              并发测速
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm("确定要清理所有未连通/超时的失效节点吗？")) pruneMutation.mutate();
              }}
              disabled={pruneMutation.isPending}
            >
              <Eraser className="h-3.5 w-3.5" />
              清理失效
            </Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Plus className="h-4 w-4" />
              导入节点
            </Button>
          </div>
        </div>

        {/* 筛选过滤器 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-2 border-t border-border/50">
          <div className="relative col-span-2 sm:col-span-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索节点名称/服务器…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Select value={region} onChange={(e) => setRegion(e.target.value)} className="h-9 text-xs">
            <option value="">全部地区</option>
            {regions.data?.map((r) => (
              <option key={r.code} value={r.code}>
                {r.flag} {r.cn} ({r.count ?? 0})
              </option>
            ))}
          </Select>

          <Select value={source} onChange={(e) => setSource(e.target.value)} className="h-9 text-xs">
            <option value="">全部来源</option>
            <option value="sub">订阅导入</option>
            <option value="manual">手动导入</option>
          </Select>

          <Select value={enabled} onChange={(e) => setEnabled(e.target.value)} className="h-9 text-xs">
            <option value="">全部状态</option>
            <option value="true">仅启用</option>
            <option value="false">仅禁用</option>
          </Select>

          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 text-xs">
            <option value="id">按添加顺序排序</option>
            <option value="latency">按测速延迟升序</option>
            <option value="name">按节点名称排序</option>
          </Select>
        </div>
      </div>

      {/* 节点数据表 */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 text-center">状态</TableHead>
            <TableHead>节点名称</TableHead>
            <TableHead className="w-24">协议</TableHead>
            <TableHead className="w-28">地区</TableHead>
            <TableHead className="w-32">延迟</TableHead>
            <TableHead>服务器 / 端口</TableHead>
            <TableHead className="w-24 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedList.map((node) => {
            const isTesting = delayPending === node.id;
            return (
              <TableRow key={node.id} className={cn(!node.enabled && "opacity-50")}>
                <TableCell className="text-center">
                  <Switch
                    checked={node.enabled}
                    onCheckedChange={(v) => toggleMutation.mutate({ id: node.id, value: v })}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-semibold text-xs text-foreground/90 max-w-[280px] truncate">
                    {node.name}
                  </div>
                  {node.source_name && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      来源: {node.source_name}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px] uppercase font-mono">
                    {node.type}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-xs font-medium">
                    {node.region || "未知"}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <LatencyBadge node={node} />
                    <button
                      onClick={() => testOne(node.id)}
                      disabled={isTesting}
                      className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
                      title="单独测速"
                    >
                      <RefreshCw className={cn("h-3 w-3", isTesting && "animate-spin text-primary")} />
                    </button>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {node.server}:{node.port}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => {
                        setEditingNode(node);
                        setEditingName(node.name);
                      }}
                      title="重命名节点"
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => {
                        if (confirm(`确定删除节点「${node.name}」吗？`)) removeMutation.mutate(node.id);
                      }}
                      title="删除节点"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-500 hover:text-rose-600" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {sortedList.length === 0 && (
        <div className="text-center py-12 bg-card/30 rounded-2xl border border-dashed border-border/70">
          <Server className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
          <h4 className="text-sm font-semibold text-foreground">没有找到匹配的节点</h4>
          <p className="text-xs text-muted-foreground mt-1">
            请尝试调整筛选条件或点击右上角导入新节点
          </p>
        </div>
      )}

      {/* 导入节点 Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>手动导入单节点分享链接</DialogTitle>
            <DialogDescription>
              支持 ss://, vmess://, vless://, trojan://, hysteria2://, tuic:// 等链接，每行一条
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Textarea
              placeholder="在此粘贴节点分享链接，支持多行批量输入…"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="min-h-[160px] font-mono text-xs"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || !importText.trim()}
            >
              {importMutation.isPending ? "解析导入中…" : "立即解析导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑节点名称 Dialog */}
      <Dialog open={!!editingNode} onOpenChange={(v) => !v && setEditingNode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>修改节点名称</DialogTitle>
            <DialogDescription>
              自定义该节点的展示名称（修改后自动同步到规则与策略组）
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Input
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              placeholder="输入新的节点名称"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditingNode(null)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => editMutation.mutate()}
              disabled={editMutation.isPending || !editingName.trim()}
            >
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function NodesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "subscriptions" ? "subscriptions" : "nodes";

  return (
    <div className="space-y-5">
      <Tabs
        value={activeTab}
        onValueChange={(tab) => {
          if (tab === "subscriptions") setSearchParams({ tab: "subscriptions" });
          else setSearchParams({});
        }}
      >
        <TabsList>
          <TabsTrigger value="nodes" className="gap-2">
            <Server className="h-4 w-4" />
            节点池
          </TabsTrigger>
          <TabsTrigger value="subscriptions" className="gap-2">
            <Radio className="h-4 w-4" />
            订阅管理
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nodes">
          <NodesPanel />
        </TabsContent>
        <TabsContent value="subscriptions">
          <SubscriptionsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
