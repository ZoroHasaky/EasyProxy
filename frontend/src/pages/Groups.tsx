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
import { api, autoApplyResultMessage, AutoApplyResponse, ProxyGroup, ProxyNode, RegionInfo } from "@/lib/api";
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

const GROUP_TYPES = [
  { value: "select", label: "手动选择 (select)", desc: "由用户在面板手动选择节点" },
  { value: "url-test", label: "自动测速 (url-test)", desc: "定时测速自动挑选延迟最低节点" },
  { value: "fallback", label: "故障回退 (fallback)", desc: "主节点故障时自动顺序切换可用节点" },
  { value: "load-balance", label: "负载均衡 (load-balance)", desc: "在可用节点间均衡分散请求" },
];

export function GroupsPanel({ embedded = false }: { embedded?: boolean }) {
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
      toast.warning(`${savedMessage}，但自动应用失败，已加入待应用清单`);
    } else {
      toast.success(`${savedMessage}，${autoApplyResultMessage(result.apply_result)}`);
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
      reportAutoApply(editingGroup ? "出站规则已更新" : "出站规则已创建", res);
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
      reportAutoApply("出站规则已删除", res);
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const generateRegionGroups = useMutation({
    mutationFn: () => api.post<{ created: number } & AutoApplyResponse>("/api/groups/generate-regions"),
    onSuccess: (res) => {
      reportAutoApply(`已根据现有节点地区自动生成 ${res.created} 个测速出站规则`, res);
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
            出站规则管理 (Outbound Rules)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            配置按地区、正则或自定义组合的出站规则，支持 url-test 速度优先与故障自动回退
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
            一键生成地区分组
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            新建出站规则
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
                      {!g.enabled && <Badge variant="secondary" className="text-[10px]">已禁用</Badge>}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {g.member_mode === "manual"
                        ? `手选节点: ${g.node_ids.length} 个`
                        : g.member_mode === "region" || (!g.member_mode && g.region)
                        ? `地区匹配: ${g.region}`
                        : g.member_mode === "regex" || (!g.member_mode && g.include_regex)
                        ? `名称正则: ${g.include_regex}`
                        : "全量节点组合"}
                    </CardDescription>
                  </div>
                  <Badge variant="purple" className="font-mono text-xs uppercase">
                    {g.type}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-border/50">
                  <div>
                    <span className="text-muted-foreground">测速间隔: </span>
                    <span className="font-medium">{g.interval}s</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">公差 (Tolerance): </span>
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
                    title="编辑出站规则"
                  >
                    <Edit className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    onClick={() => {
                      if (confirm(`确定删除出站规则「${g.name}」吗？`)) {
                        deleteMutation.mutate(g.id);
                      }
                    }}
                    title="删除出站规则"
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
            <DialogTitle>{editingGroup ? "编辑出站规则" : "新建出站规则"}</DialogTitle>
            <DialogDescription>
              设置出站规则类型、节点包含规则以及自动化测速参数
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>出站规则名称</Label>
              <Input
                placeholder="例如: 🇭🇰 香港自动测速 或 节点选择"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>出站规则类型</Label>
              <Select value={type} onChange={(e) => setType(e.target.value as any)}>
                {GROUP_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>节点范围</Label>
              <Select value={memberMode} onChange={(e) => setMemberMode(e.target.value as ProxyGroup["member_mode"])}>
                <option value="all">全部启用节点</option>
                <option value="region">按地区筛选</option>
                <option value="manual">手动勾选节点组合</option>
                <option value="regex">按节点名称正则</option>
              </Select>
            </div>

            {memberMode === "region" && (
              <div className="space-y-1.5">
                <Label>绑定地理区域</Label>
                <Select value={region} onChange={(e) => setRegion(e.target.value)}>
                  <option value="">请选择地区</option>
                  {regions.data?.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.flag} {r.cn} ({r.code})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {memberMode === "regex" && (
              <div className="space-y-1.5">
                <Label>名称匹配正则</Label>
                <Input
                  placeholder="例如 (HK|HongKong)"
                  value={includeRegex}
                  onChange={(e) => setIncludeRegex(e.target.value)}
                />
              </div>
            )}

            {memberMode === "manual" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>勾选节点组合</Label>
                  <span className="text-[11px] text-muted-foreground">已选 {nodeIDs.length} 个</span>
                </div>
                <Input
                  value={nodeSearch}
                  onChange={(e) => setNodeSearch(e.target.value)}
                  placeholder="搜索节点名称或地区…"
                  className="h-9 text-xs"
                />
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-border/60 p-2">
                  {visibleNodes.map((node) => {
                    const selected = nodeIDs.includes(node.id);
                    return (
                      <label key={node.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-accent/60">
                        <input type="checkbox" checked={selected} onChange={() => toggleNode(node.id)} />
                        <span className="min-w-0 flex-1 truncate">{node.name}</span>
                        <span className="shrink-0 text-muted-foreground">{node.region}</span>
                      </label>
                    );
                  })}
                  {visibleNodes.length === 0 && <div className="py-4 text-center text-xs text-muted-foreground">未找到启用节点</div>}
                </div>
              </div>
            )}

            {type !== "select" && (
              <>
                <div className="space-y-1.5">
                  <Label>测速目标地址 (Test URL)</Label>
                  <Input
                    value={testUrl}
                    onChange={(e) => setTestUrl(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>测速周期 (秒)</Label>
                    <Input
                      type="number"
                      value={interval}
                      onChange={(e) => setIntervalVal(Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>公差 (ms)</Label>
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
                <div className="text-xs font-semibold">启用此出站规则</div>
                <div className="text-[11px] text-muted-foreground">
                  禁用后生成配置时将被忽略
                </div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !name.trim()}
            >
              {saveMutation.isPending ? "保存中…" : "保存出站规则"}
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
