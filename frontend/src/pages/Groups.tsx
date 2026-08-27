import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Layers,
  Plus,
  Trash2,
  Edit,
  Sparkles,
  Zap,
  Check,
  RotateCcw,
} from "lucide-react";
import { api, autoApplyResultMessage, AutoApplyResponse, proxyGroupTypeLabel, ProxyGroup, ProxyNode, RegionInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { defineMessages, useLanguage, useMessages, useRegionName } from "@/contexts/language";

const GROUP_TYPES = [
  { value: "select", label: "typeSelect" },
  { value: "url-test", label: "typeUrlTest" },
  { value: "fallback", label: "typeFallback" },
  { value: "load-balance", label: "typeLoadBalance" },
] as const;

const messages = defineMessages({
  typeSelect: "手动选择 (select)", typeUrlTest: "自动测速", typeFallback: "故障回退 (fallback)", typeLoadBalance: "负载均衡 (load-balance)",
  applyFailed: "{message}，但自动应用失败，已加入待应用清单", applied: "{message}，{result}", updated: "节点组合已更新",
  created: "节点组合已创建", deleted: "节点组合已删除", generated: "已根据现有节点地区自动生成 {count} 个自动测速节点组合",
  title: "节点组合管理", description: "配置按地区、正则或自定义组合的节点组合，支持自动测速与故障自动回退",
  generateRegions: "一键生成地区分组", create: "新建节点组合", disabled: "已禁用", manualSummary: "手选节点：{count} 个",
  regionSummary: "地区匹配：{region}", regexSummary: "名称正则：{regex}", allSummary: "全量节点组合", testInterval: "测速间隔",
  tolerance: "公差 (Tolerance)", edit: "编辑节点组合", remove: "删除节点组合", confirmRemove: "确定删除节点组合「{name}」吗？",
  editTitle: "编辑节点组合", createTitle: "新建节点组合", dialogDescription: "设置节点组合类型、节点包含规则以及自动测速参数",
  name: "节点组合名称", namePlaceholder: "例如：🇭🇰 香港自动测速 或 节点选择", type: "节点组合类型", scope: "节点范围",
  allNodes: "全部启用节点", byRegion: "按地区筛选", manualNodes: "手动勾选节点组合", byRegex: "按节点名称正则",
  bindRegion: "绑定地理区域", selectRegion: "请选择地区", regex: "名称匹配正则", regexPlaceholder: "例如 (HK|HongKong)",
  selectNodes: "勾选节点组合", selected: "已选 {count} 个", searchNodes: "搜索节点名称或地区…", noNodes: "未找到启用节点",
  testUrl: "测速目标地址 (Test URL)", testCycle: "测速周期 (秒)", toleranceMs: "公差 (ms)", enable: "启用此节点组合",
  enableHint: "禁用后生成配置时将被忽略", cancel: "取消", saving: "保存中…", save: "保存节点组合",
}, {
  typeSelect: "Manual Select (select)", typeUrlTest: "Auto Test", typeFallback: "Fallback", typeLoadBalance: "Load Balance",
  applyFailed: "{message}, but automatic apply failed and the change was added to the pending list", applied: "{message}; {result}", updated: "Proxy group updated",
  created: "Proxy group created", deleted: "Proxy group deleted", generated: "Generated {count} auto-test proxy groups from existing node regions",
  title: "Proxy Groups", description: "Combine nodes by region, regular expression, or manual selection with auto testing and fallback support",
  generateRegions: "Generate Region Groups", create: "New Proxy Group", disabled: "Disabled", manualSummary: "Selected nodes: {count}",
  regionSummary: "Region: {region}", regexSummary: "Name regex: {regex}", allSummary: "All enabled nodes", testInterval: "Test Interval",
  tolerance: "Tolerance", edit: "Edit Proxy Group", remove: "Delete Proxy Group", confirmRemove: "Delete proxy group “{name}”?",
  editTitle: "Edit Proxy Group", createTitle: "New Proxy Group", dialogDescription: "Configure the group type, included nodes, and automatic test settings",
  name: "Proxy Group Name", namePlaceholder: "For example: 🇭🇰 Hong Kong Auto Test or Node Select", type: "Proxy Group Type", scope: "Node Scope",
  allNodes: "All Enabled Nodes", byRegion: "Filter by Region", manualNodes: "Select Nodes Manually", byRegex: "Match Node Name Regex",
  bindRegion: "Region", selectRegion: "Select a region", regex: "Name Regex", regexPlaceholder: "For example (HK|HongKong)",
  selectNodes: "Select Nodes", selected: "{count} selected", searchNodes: "Search node name or region…", noNodes: "No enabled nodes found",
  testUrl: "Test URL", testCycle: "Test Interval (seconds)", toleranceMs: "Tolerance (ms)", enable: "Enable Proxy Group",
  enableHint: "Disabled groups are ignored when generating the configuration", cancel: "Cancel", saving: "Saving…", save: "Save Proxy Group",
});

export function GroupsPanel({ embedded = false }: { embedded?: boolean }) {
  const text = useMessages(messages);
  const { language } = useLanguage();
  const regionName = useRegionName();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProxyGroup | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<ProxyGroup["type"]>("url-test");
  const [memberMode, setMemberMode] = useState<ProxyGroup["member_mode"]>("all");
  const [nodeIDs, setNodeIDs] = useState<number[]>([]);
  const [nodeSearch, setNodeSearch] = useState("");
  const [region, setRegion] = useState("");
  const [includeRegex, setIncludeRegex] = useState("");
  const [testUrl, setTestUrl] = useState("https://www.gstatic.com/generate_204");
  const [interval, setIntervalVal] = useState(300);
  const [tolerance, setTolerance] = useState(50);
  const [enabled, setEnabled] = useState(true);

  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.get<ProxyGroup[]>("/api/groups"),
  });

  const regions = useQuery({
    queryKey: ["nodeRegions"],
    queryFn: () => api.get<RegionInfo[]>("/api/nodes/regions"),
  });

  const nodes = useQuery({
    queryKey: ["nodes", "enabled"],
    queryFn: () => api.get<ProxyNode[]>("/api/nodes?enabled=true"),
  });

  const reportAutoApply = (savedMessage: string, result: AutoApplyResponse) => {
    if (result.apply_error) {
      toast.warning(text.applyFailed.replace("{message}", savedMessage));
    } else {
      toast.success(text.applied.replace("{message}", savedMessage).replace("{result}", autoApplyResultMessage(result.apply_result, language)));
    }
    qc.invalidateQueries({ queryKey: ["config-pending"] });
  };

  const openAdd = () => {
    setEditingGroup(null);
    setName("");
    setType("url-test");
    setMemberMode("all");
    setNodeIDs([]);
    setNodeSearch("");
    setRegion("");
    setIncludeRegex("");
    setTestUrl("https://www.gstatic.com/generate_204");
    setIntervalVal(300);
    setTolerance(50);
    setEnabled(true);
    setModalOpen(true);
  };

  const openEdit = (g: ProxyGroup) => {
    setEditingGroup(g);
    setName(g.name);
    setType(g.type);
    setMemberMode(
      g.member_mode || (g.node_ids?.length ? "manual" : g.region ? "region" : g.include_regex ? "regex" : "all"),
    );
    setNodeIDs(g.node_ids ?? []);
    setNodeSearch("");
    setRegion(g.region);
    setIncludeRegex(g.include_regex);
    setTestUrl(g.test_url);
    setIntervalVal(g.interval);
    setTolerance(g.tolerance);
    setEnabled(g.enabled);
    setModalOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        type,
        member_mode: memberMode,
        node_ids: memberMode === "manual" ? nodeIDs : [],
        region: memberMode === "region" ? region : "",
        include_regex: memberMode === "regex" ? includeRegex.trim() : "",
        test_url: testUrl.trim(),
        interval: Number(interval) || 300,
        tolerance: Number(tolerance) || 50,
        enabled,
      };
      const current = groups.data ?? [];
      const nextGroups: ProxyGroup[] = editingGroup
        ? current.map((group) =>
            group.id === editingGroup.id ? { ...group, ...payload } : group,
          )
        : [
            ...current,
            {
              id: -Date.now(),
              icon: "",
              position: current.length,
              ...payload,
            },
          ];
      return api.put<AutoApplyResponse>("/api/groups", nextGroups);
    },
    onSuccess: (res) => {
      reportAutoApply(editingGroup ? text.updated : text.created, res);
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      api.put<AutoApplyResponse>(
        "/api/groups",
        (groups.data ?? []).filter((group) => group.id !== id),
      ),
    onSuccess: (res) => {
      reportAutoApply(text.deleted, res);
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const generateRegionGroups = useMutation({
    mutationFn: () => api.post<{ created: number } & AutoApplyResponse>("/api/groups/generate-regions"),
    onSuccess: (res) => {
      reportAutoApply(text.generated.replace("{count}", String(res.created)), res);
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleNode = (id: number) => {
    setNodeIDs((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const visibleNodes = (nodes.data ?? []).filter((node) => {
    const keyword = nodeSearch.trim().toLocaleLowerCase();
    return !keyword || node.name.toLocaleLowerCase().includes(keyword) || node.region.toLocaleLowerCase().includes(keyword);
  });

  return (
    <div className="space-y-4">
      {/* 头部操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Layers className="h-4.5 w-4.5 text-primary" />
            {text.title}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {text.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateRegionGroups.mutate()}
            disabled={generateRegionGroups.isPending}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {text.generateRegions}
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            {text.create}
          </Button>
        </div>
      </div>

      {/* 策略组列表网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.data?.map((g) => {
          return (
            <Card key={g.id} className={cn("flex flex-col justify-between transition-all hover:border-primary/40", !g.enabled && "opacity-60")}>
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="truncate">{g.name}</span>
                      {!g.enabled && <Badge variant="secondary" className="text-[10px]">{text.disabled}</Badge>}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {g.member_mode === "manual"
                        ? text.manualSummary.replace("{count}", String(g.node_ids.length))
                        : g.member_mode === "region" || (!g.member_mode && g.region)
                        ? text.regionSummary.replace("{region}", regionName(g.region, g.region))
                        : g.member_mode === "regex" || (!g.member_mode && g.include_regex)
                        ? text.regexSummary.replace("{regex}", g.include_regex)
                        : text.allSummary}
                    </CardDescription>
                  </div>
                  <Badge variant="purple" className="font-mono text-xs uppercase">
                    {proxyGroupTypeLabel(g.type, language)}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-border/50">
                  <div>
                    <span className="text-muted-foreground">{text.testInterval}: </span>
                    <span className="font-medium">{g.interval}s</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{text.tolerance}: </span>
                    <span className="font-medium">{g.tolerance}ms</span>
                  </div>
                  <div className="col-span-2 text-muted-foreground text-[11px] font-mono truncate">
                    URL: {g.test_url}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1 pt-1">
                  <Button
                    variant="ghost"
                    size="iconSm"
                    onClick={() => openEdit(g)}
                    title={text.edit}
                  >
                    <Edit className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    onClick={() => {
                      if (confirm(text.confirmRemove.replace("{name}", g.name))) {
                        deleteMutation.mutate(g.id);
                      }
                    }}
                    title={text.remove}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500 hover:text-rose-600" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 策略组编辑/添加 Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingGroup ? text.editTitle : text.createTitle}</DialogTitle>
            <DialogDescription>
              {text.dialogDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{text.name}</Label>
              <Input
                placeholder={text.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{text.type}</Label>
              <Select value={type} onChange={(e) => setType(e.target.value as any)}>
                {GROUP_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {text[t.label]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{text.scope}</Label>
              <Select value={memberMode} onChange={(e) => setMemberMode(e.target.value as ProxyGroup["member_mode"])}>
                <option value="all">{text.allNodes}</option>
                <option value="region">{text.byRegion}</option>
                <option value="manual">{text.manualNodes}</option>
                <option value="regex">{text.byRegex}</option>
              </Select>
            </div>

            {memberMode === "region" && (
              <div className="space-y-1.5">
                <Label>{text.bindRegion}</Label>
                <Select value={region} onChange={(e) => setRegion(e.target.value)}>
                  <option value="">{text.selectRegion}</option>
                  {regions.data?.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.flag} {regionName(r.code, r.cn)} ({r.code})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {memberMode === "regex" && (
              <div className="space-y-1.5">
                <Label>{text.regex}</Label>
                <Input
                  placeholder={text.regexPlaceholder}
                  value={includeRegex}
                  onChange={(e) => setIncludeRegex(e.target.value)}
                />
              </div>
            )}

            {memberMode === "manual" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{text.selectNodes}</Label>
                  <span className="text-[11px] text-muted-foreground">{text.selected.replace("{count}", String(nodeIDs.length))}</span>
                </div>
                <Input
                  value={nodeSearch}
                  onChange={(e) => setNodeSearch(e.target.value)}
                  placeholder={text.searchNodes}
                  className="h-9 text-xs"
                />
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-border/60 p-2">
                  {visibleNodes.map((node) => {
                    const selected = nodeIDs.includes(node.id);
                    return (
                      <label key={node.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent/60">
                        <input type="checkbox" checked={selected} onChange={() => toggleNode(node.id)} />
                        <span className="min-w-0 flex-1 truncate">{node.name}</span>
                        <span className="shrink-0 text-muted-foreground">{regionName(node.region, node.region)}</span>
                      </label>
                    );
                  })}
                  {visibleNodes.length === 0 && <div className="py-4 text-center text-xs text-muted-foreground">{text.noNodes}</div>}
                </div>
              </div>
            )}

            {type !== "select" && (
              <>
                <div className="space-y-1.5">
                  <Label>{text.testUrl}</Label>
                  <Input
                    value={testUrl}
                    onChange={(e) => setTestUrl(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{text.testCycle}</Label>
                    <Input
                      type="number"
                      value={interval}
                      onChange={(e) => setIntervalVal(Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>{text.toleranceMs}</Label>
                    <Input
                      type="number"
                      value={tolerance}
                      onChange={(e) => setTolerance(Number(e.target.value))}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold">{text.enable}</div>
                <div className="text-[11px] text-muted-foreground">
                  {text.enableHint}
                </div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>
              {text.cancel}
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !name.trim()}
            >
              {saveMutation.isPending ? text.saving : text.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function GroupsPage() {
  return <GroupsPanel />;
}
