import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  CheckCircle2,
  Clock,
  Download,
  Filter,
  Gauge,
  Layers,
  Pencil,
  Plus,
  Radio,
  Search,
  Server,
  Trash2,
  Zap,
} from "lucide-react";
import { api, autoApplyResultMessage, AutoApplyResponse, ProxyNode, RegionInfo } from "@/lib/api";
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
import { defineMessages, useLanguage, useMessages, useRegionName } from "@/contexts/language";

const messages = defineMessages({
  untested: "未测速", timeout: "超时", applyFailed: "{message}，但自动应用失败，已加入待应用清单", applied: "{message}，{result}",
  tested: "测速完成，共测试 {count} 个节点", enabled: "节点已启用", disabled: "节点已禁用", deleted: "节点已删除",
  parametersUpdated: "节点参数已更新", nameUpdated: "节点名称已更新", invalidObject: "节点参数必须是有效的 JSON 对象",
  objectRequired: "节点参数必须是 JSON 对象", testSuccess: "测速成功：{delay} ms", imported: "导入成功，新增 {count} 个节点",
  title: "节点池总览", nodeCount: "{count} 个节点", testAll: "并发测速", importNodes: "导入节点", search: "搜索节点名称/服务器…",
  allRegions: "全部地区", allSources: "全部来源", subscriptionImport: "订阅导入", manualImport: "手动导入",
  allStatuses: "全部状态", enabledOnly: "仅启用", disabledOnly: "仅禁用", sortAdded: "按添加顺序排序",
  sortLatency: "按测速延迟升序", sortName: "按节点名称排序", status: "状态", nodeName: "节点名称", protocol: "协议",
  region: "地区", latency: "延迟", serverPort: "服务器 / 端口", actions: "操作", source: "来源", unknown: "未知",
  testOne: "单独测速", editFull: "编辑完整节点参数", rename: "重命名节点", remove: "删除节点",
  confirmRemove: "确定删除节点「{name}」吗？", emptyTitle: "没有找到匹配的节点", emptyDescription: "请尝试调整筛选条件或点击右上角导入新节点",
  importTitle: "手动导入单节点分享链接", importDescription: "支持 ss://、vmess://、vless://、trojan://、hysteria2://、tuic:// 等链接，每行一条",
  importPlaceholder: "在此粘贴节点分享链接，支持多行批量输入…", cancel: "取消", importing: "解析导入中…", importNow: "立即解析导入",
  editManualTitle: "编辑手动节点参数", editNameTitle: "修改节点名称", editManualDescription: "可修改完整 Mihomo 节点配置；保存后会自动重新加载当前有效配置。",
  editNameDescription: "自定义该节点的展示名称（修改后自动同步到规则与节点组合）", fullConfig: "完整节点参数（JSON）",
  requiredFields: "必填字段：name、type、server、port；其余协议参数会原样保存。", regionOptional: "地区标签（可选）",
  regionPlaceholder: "例如 HK、US；留空则显示为未知地区", namePlaceholder: "输入新的节点名称", saving: "保存中…", saveChanges: "保存修改",
  subscriptions: "订阅管理", nodePool: "节点池",
}, {
  untested: "Not Tested", timeout: "Timed Out", applyFailed: "{message}, but automatic apply failed and the change was added to the pending list", applied: "{message}; {result}",
  tested: "Latency test complete for {count} nodes", enabled: "Node enabled", disabled: "Node disabled", deleted: "Node deleted",
  parametersUpdated: "Node settings updated", nameUpdated: "Node name updated", invalidObject: "Node settings must be a valid JSON object",
  objectRequired: "Node settings must be a JSON object", testSuccess: "Latency test succeeded: {delay} ms", imported: "Import complete: {count} new nodes",
  title: "Node Pool", nodeCount: "{count} nodes", testAll: "Test All", importNodes: "Import Nodes", search: "Search node name or server…",
  allRegions: "All Regions", allSources: "All Sources", subscriptionImport: "Subscription", manualImport: "Manual Import",
  allStatuses: "All Statuses", enabledOnly: "Enabled Only", disabledOnly: "Disabled Only", sortAdded: "Sort by Date Added",
  sortLatency: "Sort by Latency", sortName: "Sort by Node Name", status: "Status", nodeName: "Node Name", protocol: "Protocol",
  region: "Region", latency: "Latency", serverPort: "Server / Port", actions: "Actions", source: "Source", unknown: "Unknown",
  testOne: "Test This Node", editFull: "Edit Full Node Settings", rename: "Rename Node", remove: "Delete Node",
  confirmRemove: "Delete node “{name}”?", emptyTitle: "No matching nodes", emptyDescription: "Adjust the filters or import a new node from the upper-right corner",
  importTitle: "Import Individual Node Links", importDescription: "Supports ss://, vmess://, vless://, trojan://, hysteria2://, tuic://, and similar links, one per line",
  importPlaceholder: "Paste node share links here, one per line…", cancel: "Cancel", importing: "Parsing and Importing…", importNow: "Parse and Import",
  editManualTitle: "Edit Manual Node Settings", editNameTitle: "Rename Node", editManualDescription: "Edit the full Mihomo node configuration. The active configuration reloads automatically after saving.",
  editNameDescription: "Change the node's display name. Rules and proxy groups are updated automatically.", fullConfig: "Full Node Settings (JSON)",
  requiredFields: "Required fields: name, type, server, and port. Other protocol settings are preserved as entered.", regionOptional: "Region Tag (optional)",
  regionPlaceholder: "For example HK or US; leave empty for Unknown", namePlaceholder: "Enter a new node name", saving: "Saving…", saveChanges: "Save Changes",
  subscriptions: "Subscriptions", nodePool: "Node Pool",
});

function LatencyBadge({ node }: { node: ProxyNode }) {
  const text = useMessages(messages);
  if (!node.latency_at) return <span className="whitespace-nowrap text-xs font-mono text-muted-foreground">{text.untested}</span>;
  if (!node.alive || node.latency === 0) return <Badge variant="destructive" className="whitespace-nowrap">{text.timeout}</Badge>;
  const variant = node.latency < 200 ? "success" : node.latency < 600 ? "warning" : "secondary";
  return (
    <Badge variant={variant as any} className="whitespace-nowrap font-mono text-[11px]">
      {node.latency} ms
    </Badge>
  );
}

export function NodesPanel({ embedded = false }: { embedded?: boolean }) {
  const text = useMessages(messages);
  const { language } = useLanguage();
  const regionName = useRegionName();
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
  const [editingRawConfig, setEditingRawConfig] = useState("");
  const [editingRegion, setEditingRegion] = useState("");

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

  const reportAutoApply = (savedMessage: string, result: AutoApplyResponse) => {
    if (result.apply_error) {
      toast.warning(text.applyFailed.replace("{message}", savedMessage));
    } else {
      toast.success(text.applied.replace("{message}", savedMessage).replace("{result}", autoApplyResultMessage(result.apply_result, language)));
    }
    qc.invalidateQueries({ queryKey: ["config-pending"] });
  };

  const checkMutation = useMutation({
    mutationFn: () =>
      api.post<{ tested: number }>("/api/nodes/check", {
        ids: (nodes.data ?? []).filter((node) => node.enabled).map((node) => node.id),
      }),
    onSuccess: (res) => {
      toast.success(text.tested.replace("{count}", String(res.tested)));
      qc.invalidateQueries({ queryKey: ["nodes"] });
    },
    onError: (e: any) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) =>
      api.patch<AutoApplyResponse>(`/api/nodes/${id}`, { enabled: value }),
    onSuccess: (res, { value }) => {
      reportAutoApply(value ? text.enabled : text.disabled, res);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => api.del<AutoApplyResponse>(`/api/nodes/${id}`),
    onSuccess: (res) => {
      reportAutoApply(text.deleted, res);
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api.patch<AutoApplyResponse>(`/api/nodes/${id}`, body),
    onSuccess: (res) => {
      reportAutoApply(editingNode?.source_type === "manual" ? text.parametersUpdated : text.nameUpdated, res);
      setEditingNode(null);
      setEditingName("");
      setEditingRawConfig("");
      setEditingRegion("");
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openNodeEditor = (node: ProxyNode) => {
    setEditingNode(node);
    setEditingName(node.name);
    setEditingRawConfig(JSON.stringify(node.raw_config, null, 2));
    setEditingRegion(node.region);
  };

  const saveNodeEdits = () => {
    if (!editingNode) return;
    if (editingNode.source_type !== "manual") {
      editMutation.mutate({ id: editingNode.id, body: { name: editingName.trim() } });
      return;
    }
    let rawConfig: unknown;
    try {
      rawConfig = JSON.parse(editingRawConfig);
    } catch {
      toast.error(text.invalidObject);
      return;
    }
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      toast.error(text.objectRequired);
      return;
    }
    editMutation.mutate({
      id: editingNode.id,
      body: { raw_config: rawConfig, region: editingRegion.trim() },
    });
  };

  const testOne = async (id: number) => {
    setDelayPending(id);
    try {
      const res = await api.get<{ delay: number }>(`/api/nodes/${id}/delay`);
      toast.success(text.testSuccess.replace("{delay}", String(res.delay)));
      qc.invalidateQueries({ queryKey: ["nodes"] });
    } catch (e: any) {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    } finally {
      setDelayPending(null);
    }
  };

  const importMutation = useMutation({
    mutationFn: () => api.post<{ added: number; duplicated: number } & AutoApplyResponse>("/api/nodes/import", { content: importText }),
    onSuccess: (res) => {
      reportAutoApply(text.imported.replace("{count}", String(res.added)), res);
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
            <h3 className="font-bold text-base tracking-tight">{text.title}</h3>
            <Badge variant="secondary" className="font-mono text-xs">
              {text.nodeCount.replace("{count}", String(rawList.length))}
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
              {text.testAll}
            </Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Plus className="h-4 w-4" />
              {text.importNodes}
            </Button>
          </div>
        </div>

        {/* 筛选过滤器 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-2 border-t border-border/50">
          <div className="relative col-span-2 sm:col-span-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={text.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Select value={region} onChange={(e) => setRegion(e.target.value)} className="h-9 text-xs">
            <option value="">{text.allRegions}</option>
            {regions.data?.map((r) => (
              <option key={r.code} value={r.code}>
                {r.flag} {regionName(r.code, r.cn)} ({r.count ?? 0})
              </option>
            ))}
          </Select>

          <Select value={source} onChange={(e) => setSource(e.target.value)} className="h-9 text-xs">
            <option value="">{text.allSources}</option>
            <option value="sub">{text.subscriptionImport}</option>
            <option value="manual">{text.manualImport}</option>
          </Select>

          <Select value={enabled} onChange={(e) => setEnabled(e.target.value)} className="h-9 text-xs">
            <option value="">{text.allStatuses}</option>
            <option value="true">{text.enabledOnly}</option>
            <option value="false">{text.disabledOnly}</option>
          </Select>

          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 text-xs">
            <option value="id">{text.sortAdded}</option>
            <option value="latency">{text.sortLatency}</option>
            <option value="name">{text.sortName}</option>
          </Select>
        </div>
      </div>

      {/* 节点数据表 */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 text-center">{text.status}</TableHead>
            <TableHead>{text.nodeName}</TableHead>
            <TableHead className="w-24">{text.protocol}</TableHead>
            <TableHead className="w-28">{text.region}</TableHead>
            <TableHead className="w-32">{text.latency}</TableHead>
            <TableHead>{text.serverPort}</TableHead>
            <TableHead className="w-24 text-right">{text.actions}</TableHead>
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
                      {text.source}: {node.source_name}
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
                    {node.region ? regionName(node.region, node.region) : text.unknown}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <LatencyBadge node={node} />
                    <button
                      onClick={() => testOne(node.id)}
                      disabled={isTesting}
                      className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
                      title={text.testOne}
                    >
                      <Zap className={cn("h-3 w-3", isTesting && "animate-pulse text-primary")} />
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
                        openNodeEditor(node);
                      }}
                      title={node.source_type === "manual" ? text.editFull : text.rename}
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => {
                        if (confirm(text.confirmRemove.replace("{name}", node.name))) removeMutation.mutate(node.id);
                      }}
                      title={text.remove}
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
          <h4 className="text-sm font-semibold text-foreground">{text.emptyTitle}</h4>
          <p className="text-xs text-muted-foreground mt-1">
            {text.emptyDescription}
          </p>
        </div>
      )}

      {/* 导入节点 Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{text.importTitle}</DialogTitle>
            <DialogDescription>
              {text.importDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Textarea
              placeholder={text.importPlaceholder}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="min-h-[160px] font-mono text-xs"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(false)}>
              {text.cancel}
            </Button>
            <Button
              size="sm"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || !importText.trim()}
            >
              {importMutation.isPending ? text.importing : text.importNow}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑节点 Dialog */}
      <Dialog open={!!editingNode} onOpenChange={(v) => !v && setEditingNode(null)}>
        <DialogContent className={cn("sm:max-w-md", editingNode?.source_type === "manual" && "sm:max-w-2xl")}>
          <DialogHeader>
            <DialogTitle>{editingNode?.source_type === "manual" ? text.editManualTitle : text.editNameTitle}</DialogTitle>
            <DialogDescription>
              {editingNode?.source_type === "manual"
                ? text.editManualDescription
                : text.editNameDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {editingNode?.source_type === "manual" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="node-raw-config">{text.fullConfig}</Label>
                  <Textarea
                    id="node-raw-config"
                    value={editingRawConfig}
                    onChange={(e) => setEditingRawConfig(e.target.value)}
                    spellCheck={false}
                    className="min-h-[360px] font-mono text-xs leading-5"
                  />
                  <p className="text-xs text-muted-foreground">
                    {text.requiredFields}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="node-region">{text.regionOptional}</Label>
                  <Input
                    id="node-region"
                    value={editingRegion}
                    onChange={(e) => setEditingRegion(e.target.value)}
                    placeholder={text.regionPlaceholder}
                  />
                </div>
              </>
            ) : (
              <Input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                placeholder={text.namePlaceholder}
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditingNode(null)}>
              {text.cancel}
            </Button>
            <Button
              size="sm"
              onClick={saveNodeEdits}
              disabled={editMutation.isPending || (editingNode?.source_type !== "manual" && !editingName.trim())}
            >
              {editMutation.isPending ? text.saving : text.saveChanges}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function NodesPage() {
  const text = useMessages(messages);
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
          <TabsTrigger value="subscriptions" className="gap-2">
            <Radio className="h-4 w-4" />
            {text.subscriptions}
          </TabsTrigger>
          <TabsTrigger value="nodes" className="gap-2">
            <Server className="h-4 w-4" />
            {text.nodePool}
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
