import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gauge, Plus, Trash2, Zap, Eraser, Pencil } from "lucide-react";
import { api, ProxyNode, RegionInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SubscriptionsPanel } from "@/pages/Subscriptions";

function latencyBadge(n: ProxyNode) {
  if (!n.latency_at) return <span className="text-muted-foreground text-xs">未测速</span>;
  if (!n.alive || n.latency === 0) return <Badge variant="destructive">超时</Badge>;
  const v = n.latency < 300 ? "success" : n.latency < 1000 ? "warning" : "secondary";
  return <Badge variant={v as any}>{n.latency} ms</Badge>;
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

  const check = useMutation({
    mutationFn: () =>
      api.post<{ tested: number }>("/api/nodes/check", {
        ids: (nodes.data ?? []).filter((node) => node.enabled).map((node) => node.id),
      }),
    onSuccess: (res) => {
      toast.success(`当前筛选结果测速完成，共 ${res.tested} 个节点`);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    },
    onError: (e: any) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) =>
      api.patch(`/api/nodes/${id}`, { enabled: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nodes"] }),
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/nodes/${id}`),
    onSuccess: () => {
      toast.success("已删除");
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
      qc.invalidateQueries({ queryKey: ["preview"] });
    },
  });
  const edit = useMutation({
    mutationFn: () =>
      api.patch(`/api/nodes/${editingNode!.id}`, { name: editingName.trim() }),
    onSuccess: () => {
      toast.success("节点名称已保存");
      setEditingNode(null);
      setEditingName("");
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
      qc.invalidateQueries({ queryKey: ["preview"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const prune = useMutation({
    mutationFn: () => api.post<{ removed: number }>("/api/nodes/prune"),
    onSuccess: (res) => {
      toast.success(`已清理 ${res.removed} 个失效节点`);
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const testOne = async (id: number) => {
    setDelayPending(id);
    try {
      const res = await api.get<{ delay: number }>(`/api/nodes/${id}/delay`);
      toast.success(`测速完成：${res.delay} ms`);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    } catch (e: any) {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    } finally {
      setDelayPending(null);
    }
  };
  const doImport = useMutation({
    mutationFn: () => api.post<{ added: number; duplicated: number }>("/api/nodes/import", { content: importText }),
    onSuccess: (res) => {
      toast.success(`导入成功：新增 ${res.added}，重复跳过 ${res.duplicated}`);
      setImportOpen(false);
      setImportText("");
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const list = [...(nodes.data ?? [])];
  if (sort === "latency") {
    list.sort((a, b) => (a.latency_at ? (b.latency_at ? a.latency - b.latency : -1) : 1));
  }
  const testableCount = (nodes.data ?? []).filter((node) => node.enabled).length;

  const regionFlag = (code: string) => regions.data?.find((r) => r.code === code)?.flag ?? "🌐";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          {!embedded && (
            <h1 className="text-xl font-semibold">
              节点池（{nodes.data?.length ?? 0}）
            </h1>
          )}
          {embedded && (
            <>
              <div className="text-sm font-medium">
                节点池（{nodes.data?.length ?? 0}）
              </div>
              <p className="text-xs text-muted-foreground">
                查看、筛选、测速和管理订阅或手工导入的节点。
              </p>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => check.mutate()}
            disabled={check.isPending || nodes.isLoading || testableCount === 0}
            title={`测速当前筛选结果中的 ${testableCount} 个启用节点`}
          >
            <Gauge className={cn("h-4 w-4", check.isPending && "animate-pulse")} />
            {check.isPending ? "测速中…" : "整组测速"}
          </Button>
          <Button
            variant="outline"
            onClick={() => { if (confirm("删除所有已测速且超时/失活的节点？")) prune.mutate(); }}
            disabled={prune.isPending}
          >
            <Eraser className="h-4 w-4" /> 清理失效
          </Button>
          <Button onClick={() => setImportOpen(true)}>
            <Plus className="h-4 w-4" /> 导入节点
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input className="w-56" placeholder="搜索名称 / 服务器" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-36" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">全部地区</option>
          {(regions.data ?? [])
            .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
            .map((r) => (
              <option key={r.code} value={r.code}>{r.flag} {r.cn} ({r.count ?? 0})</option>
            ))}
        </Select>
        <Select className="w-32" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">全部来源</option>
          <option value="sub">订阅</option>
          <option value="manual">手动</option>
        </Select>
        <Select className="w-32" value={enabled} onChange={(e) => setEnabled(e.target.value)}>
          <option value="">全部状态</option>
          <option value="true">已启用</option>
          <option value="false">已禁用</option>
        </Select>
        <Select className="w-36" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="id">默认排序</option>
          <option value="latency">按延迟</option>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>节点</TableHead>
            <TableHead>地区</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>所属订阅</TableHead>
            <TableHead>延迟</TableHead>
            <TableHead>启用</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.slice(0, 500).map((n) => (
            <TableRow key={n.id} className={!n.enabled ? "opacity-50" : ""}>
              <TableCell className="max-w-64 truncate font-medium">{n.name}</TableCell>
              <TableCell>{regionFlag(n.region)} {n.region}</TableCell>
              <TableCell><Badge variant="outline">{n.type}</Badge></TableCell>
              <TableCell className="max-w-40 truncate text-xs">
                {n.source_type === "sub" ? (n.source_name || `订阅#${n.source_id}`) : "手动"}
              </TableCell>
              <TableCell>{latencyBadge(n)}</TableCell>
              <TableCell>
                <Switch checked={n.enabled} onCheckedChange={(v) => toggle.mutate({ id: n.id, value: v })} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" title="测速"
                    onClick={() => testOne(n.id)} disabled={delayPending === n.id}>
                    <Zap className={cn("h-4 w-4 text-amber-500", delayPending === n.id && "animate-pulse")} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="修改节点"
                    onClick={() => {
                      setEditingNode(n);
                      setEditingName(n.name);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title="删除"
                    onClick={() => { if (confirm(`删除节点 ${n.name}？`)) remove.mutate(n.id); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {nodes.data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                节点池为空，请先添加订阅或导入节点
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {(nodes.data?.length ?? 0) > 500 && (
        <div className="text-center text-xs text-muted-foreground">仅显示前 500 条，请用筛选缩小范围</div>
      )}

      <Dialog
        open={!!editingNode}
        onOpenChange={(open) => {
          if (!open) {
            setEditingNode(null);
            setEditingName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改节点</DialogTitle>
            <DialogDescription>
              修改节点显示名称，不改变服务器和协议参数。订阅节点下次更新时可能恢复订阅中的名称。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>节点名称</Label>
            <Input
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              placeholder="唯一节点名称"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingNode(null)}>
              取消
            </Button>
            <Button
              onClick={() => edit.mutate()}
              disabled={edit.isPending || !editingName.trim()}
            >
              {edit.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>导入节点</DialogTitle>
            <DialogDescription>
              粘贴分享链接（每行一条，支持 ss/vmess/vless/trojan/hysteria2/tuic），也支持 Clash YAML 或 Base64
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={10}
            placeholder={"ss://…\nvmess://…\nhysteria2://…"}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button onClick={() => doImport.mutate()} disabled={doImport.isPending || !importText.trim()}>
              {doImport.isPending ? "导入中…" : "导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function NodesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = requestedTab === "pool" ? "pool" : "subscriptions";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">节点</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          统一管理订阅来源与节点池。
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(tab) => setSearchParams({ tab }, { replace: true })}
      >
        <TabsList className="grid h-auto w-full grid-cols-2 p-1">
          <TabsTrigger value="subscriptions">订阅</TabsTrigger>
          <TabsTrigger value="pool">节点池</TabsTrigger>
        </TabsList>
        <TabsContent
          value="subscriptions"
          forceMount
          className={cn("mt-4", activeTab !== "subscriptions" && "hidden")}
        >
          <SubscriptionsPanel embedded />
        </TabsContent>
        <TabsContent
          value="pool"
          forceMount
          className={cn("mt-4", activeTab !== "pool" && "hidden")}
        >
          <NodesPanel embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
