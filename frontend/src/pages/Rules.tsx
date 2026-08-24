import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileInput,
  GripVertical,
  Info,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  ScrollText,
  Search,
  Trash2,
  Upload,
  Zap,
  Globe,
  Radio,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import {
  api,
  GenResult,
  Rule,
  RuleProvider,
  RuleProviderContent,
  RulesPayload,
  RuleTargetOption,
  RuleTemplatePreview,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GroupsPanel } from "@/pages/Groups";
import { cn } from "@/lib/utils";

const KINDS = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "DOMAIN-REGEX",
  "IP-CIDR",
  "IP-CIDR6",
  "GEOIP",
  "GEOSITE",
  "SRC-IP-CIDR",
  "SRC-PORT",
  "DST-PORT",
  "PROCESS-NAME",
  "PROCESS-PATH",
  "IN-TYPE",
  "RULE-SET",
  "MATCH",
];

const KIND_LABELS: Record<string, string> = {
  DOMAIN: "完整域名",
  "DOMAIN-SUFFIX": "域名后缀",
  "DOMAIN-KEYWORD": "域名关键字",
  "DOMAIN-REGEX": "域名正则",
  "IP-CIDR": "IP 网段",
  "IP-CIDR6": "IPv6 网段",
  GEOIP: "GeoIP 国家",
  GEOSITE: "GeoSite 分类",
  "SRC-IP-CIDR": "来源 IP 网段",
  "SRC-PORT": "来源端口",
  "DST-PORT": "目标端口",
  "PROCESS-NAME": "进程名称",
  "PROCESS-PATH": "进程路径",
  "IN-TYPE": "入站类型",
  "RULE-SET": "规则集 (Rule-Set)",
  MATCH: "最终兜底",
};

function SortableOutboundCard({
  rule,
  index,
  targetOptions,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: Rule;
  index: number;
  targetOptions: RuleTargetOption[];
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const targetName =
    ({ PROXY: "PROXY（默认代理）", DIRECT: "DIRECT（直连）", REJECT: "REJECT（拒绝连接）" } as Record<string, string>)[rule.target] ??
    targetOptions.find((option) => option.value === rule.target)?.name ??
    rule.target;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex min-h-52 flex-col rounded-2xl border bg-card/60 p-4 backdrop-blur-sm transition-all duration-150",
        isDragging
          ? "opacity-50 shadow-2xl border-primary scale-[1.01] z-50"
          : "border-border/60 hover:border-primary/40",
        !rule.enabled && "opacity-40"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            {...attributes}
            {...listeners}
            title="拖拽调整优先级"
            className="cursor-grab rounded-md p-1 text-muted-foreground/50 transition-colors hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {rule.kind}
          </Badge>
        </div>
        <Switch checked={rule.enabled} onCheckedChange={onToggle} />
      </div>

      <div className="flex-1 space-y-4 pt-4">
        <div>
          <div className="text-[11px] text-muted-foreground">匹配条件</div>
          <div className="mt-1 truncate font-mono text-xs font-medium" title={rule.value}>
            {rule.value || <span className="italic text-muted-foreground">(最终兜底规则)</span>}
          </div>
        </div>
        <div className="flex items-end justify-between gap-3 border-t border-border/40 pt-3">
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">目标出口</div>
            <div className="mt-1 truncate text-xs font-semibold text-primary" title={targetName}>
              {targetName}
            </div>
          </div>
          {rule.no_resolve && <Badge variant="secondary" className="shrink-0 text-[10px]">不解析 DNS</Badge>}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/40 pt-3">
        <span className="font-mono text-[11px] text-muted-foreground">优先级 #{index + 1}</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> 编辑
          </Button>
          <Button variant="ghost" size="iconSm" onClick={onDelete} title="删除出站规则">
            <Trash2 className="h-3.5 w-3.5 text-rose-500 hover:text-rose-600" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RecognitionRulesPanel({
  providers,
  onAdd,
  onEdit,
  onDelete,
  onViewContent,
}: {
  providers: RuleProvider[];
  onAdd: () => void;
  onEdit: (p: RuleProvider) => void;
  onDelete: (p: RuleProvider) => void;
  onViewContent: (p: RuleProvider) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <ScrollText className="h-4.5 w-4.5 text-primary" />
            识别规则提供者 (Rule Providers)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            共 {providers.length} 个规则集，负责下载并解析域名集或 IP 地址网段
          </p>
        </div>

        <Button size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          新建识别规则
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {providers.map((p) => (
          <div
            key={p.id}
            className="flex flex-col justify-between p-4 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm hover:border-primary/40 transition-all duration-150 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="font-bold text-sm text-foreground/90 flex items-center gap-2">
                  <span className="truncate">{p.name}</span>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[200px]" title={p.url}>
                  {p.url}
                </div>
              </div>
              <Badge variant="purple" className="text-[10px] font-mono uppercase">
                {p.behavior}
              </Badge>
            </div>

            <div className="flex items-center justify-between text-xs py-2 border-y border-border/40">
              <span className="text-muted-foreground">规则条数:</span>
              <span className="font-mono font-semibold">{p.rule_count !== undefined ? `${p.rule_count} 条` : "待下载"}</span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => onViewContent(p)}
              >
                <Eye className="h-3.5 w-3.5" /> 查看词条
              </Button>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="iconSm" onClick={() => onEdit(p)} title="修改">
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </Button>
                <Button variant="ghost" size="iconSm" onClick={() => onDelete(p)} title="删除">
                  <Trash2 className="h-3.5 w-3.5 text-rose-500 hover:text-rose-600" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {providers.length === 0 && (
        <div className="text-center py-12 bg-card/30 rounded-2xl border border-dashed border-border/70">
          <ScrollText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
          <h4 className="text-sm font-semibold text-foreground">暂无识别规则提供者</h4>
          <p className="text-xs text-muted-foreground mt-1">
            可点击右上角新建，或通过“从模板加载”一键导入 ACL4SSR 规则集
          </p>
        </div>
      )}
    </div>
  );
}

export function OutboundRulesPanel({
  rules,
  targetOptions,
  onAddRule,
  onPreviewYaml,
  onDragEnd,
  onToggleRule,
  onEditRule,
  onDeleteRule,
}: {
  rules: Rule[];
  targetOptions: RuleTargetOption[];
  onAddRule: () => void;
  onPreviewYaml: () => void;
  onDragEnd: (event: DragEndEvent) => void;
  onToggleRule: (id: number, enabled: boolean) => void;
  onEditRule: (rule: Rule) => void;
  onDeleteRule: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const filteredRules = rules.filter((r) => {
    if (!q.trim()) return true;
    const kw = q.toLowerCase();
    return (
      r.value.toLowerCase().includes(kw) ||
      r.kind.toLowerCase().includes(kw) ||
      r.target.toLowerCase().includes(kw)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Radio className="h-4.5 w-4.5 text-primary" />
            出站分流规则 (Outbound Rules)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            共 {rules.length} 条出站分流策略 · 支持抓手实时拖拽改变匹配优先级
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onPreviewYaml}>
            <Eye className="h-3.5 w-3.5" />
            预览生成的 YAML
          </Button>
          <Button size="sm" onClick={onAddRule}>
            <Plus className="h-4 w-4" />
            添加出站规则
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索出站规则、匹配类型或处理目标策略…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9 h-9 text-xs"
        />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={filteredRules.map((r) => r.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredRules.map((rule, idx) => (
              <SortableOutboundCard
                key={rule.id}
                rule={rule}
                index={idx}
                targetOptions={targetOptions}
                onToggle={(en) => onToggleRule(rule.id, en)}
                onEdit={() => onEditRule(rule)}
                onDelete={() => onDeleteRule(rule.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

export default function RulesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const requestedTab = searchParams.get("tab");
  const activeTab = ["recognition", "groups", "outbound"].includes(
    requestedTab ?? ""
  )
    ? requestedTab!
    : "recognition";

  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateUrl, setTemplateUrl] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // 识别规则编辑
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<RuleProvider | null>(
    null
  );
  const [providerName, setProviderName] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [providerBehavior, setProviderBehavior] = useState("domain");
  const [providerInterval, setProviderInterval] = useState(86400);

  // 查看识别规则词条
  const [contentProvider, setContentProvider] = useState<RuleProvider | null>(
    null
  );

  // 出站规则编辑
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [newKind, setNewKind] = useState("DOMAIN-SUFFIX");
  const [newValue, setNewValue] = useState("");
  const [newTarget, setNewTarget] = useState("PROXY");
  const [newNoResolve, setNewNoResolve] = useState(false);

  const rulesQuery = useQuery({
    queryKey: ["currentRules"],
    queryFn: () => api.get<RulesPayload>("/api/rules"),
  });

  const targetsQuery = useQuery({
    queryKey: ["ruleTargets"],
    queryFn: () => api.get<RuleTargetOption[]>("/api/rule-targets"),
  });

  const previewQuery = useQuery({
    queryKey: ["configPreview"],
    queryFn: () => api.get<GenResult>("/api/config/preview"),
    enabled: previewModalOpen,
  });

  const providerContentQuery = useQuery({
    queryKey: ["providerContent", contentProvider?.id],
    queryFn: () =>
      api.get<RuleProviderContent>(
        `/api/rule-providers/${contentProvider!.id}/content?page=1&size=100`
      ),
    enabled: !!contentProvider,
  });

  const rawRules = rulesQuery.data?.rules ?? [];
  const providers = rulesQuery.data?.providers ?? [];
  const targetOptions = targetsQuery.data ?? [];

  // 保存整个规则 Payload
  const persistPayload = useMutation({
    mutationFn: ({
      nextRules,
      nextProviders,
    }: {
      nextRules: Rule[];
      nextProviders: RuleProvider[];
    }) => api.put("/api/rules", { rules: nextRules, providers: nextProviders }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["currentRules"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // 识别规则操作
  const openAddProvider = () => {
    setEditingProvider(null);
    setProviderName("");
    setProviderUrl("");
    setProviderBehavior("domain");
    setProviderInterval(86400);
    setProviderModalOpen(true);
  };

  const openEditProvider = (p: RuleProvider) => {
    setEditingProvider(p);
    setProviderName(p.name);
    setProviderUrl(p.url);
    setProviderBehavior(p.behavior);
    setProviderInterval(p.interval || 86400);
    setProviderModalOpen(true);
  };

  const saveProvider = async () => {
    if (!providerName.trim() || !providerUrl.trim()) {
      toast.error("识别规则名称和 URL 不能为空");
      return;
    }
    const nextItem: RuleProvider = {
      id: editingProvider ? editingProvider.id : -Date.now(),
      template_id: 0,
      name: providerName.trim(),
      url: providerUrl.trim(),
      behavior: providerBehavior,
      format: "mrs",
      interval: Number(providerInterval) || 86400,
    };

    const nextProviders = editingProvider
      ? providers.map((p) => (p.id === editingProvider.id ? nextItem : p))
      : [...providers, nextItem];

    await persistPayload.mutateAsync({
      nextRules: rawRules,
      nextProviders,
    });
    toast.success(editingProvider ? "识别规则已修改" : "识别规则已创建");
    setProviderModalOpen(false);
  };

  const deleteProvider = async (p: RuleProvider) => {
    if (!confirm(`确定删除识别规则「${p.name}」吗？`)) return;
    const nextProviders = providers.filter((item) => item.id !== p.id);
    await persistPayload.mutateAsync({
      nextRules: rawRules,
      nextProviders,
    });
    toast.success("识别规则已删除");
  };

  // 出站规则操作
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = rawRules.findIndex((r) => r.id === active.id);
    const newIndex = rawRules.findIndex((r) => r.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newRules = arrayMove(rawRules, oldIndex, newIndex);
    qc.setQueryData(["currentRules"], { ...rulesQuery.data, rules: newRules });

    await persistPayload.mutateAsync({
      nextRules: newRules,
      nextProviders: providers,
    });
    toast.success("出站规则顺序已保存");
  };

  const handleToggleRule = async (id: number, enabled: boolean) => {
    const nextRules = rawRules.map((r) => (r.id === id ? { ...r, enabled } : r));
    await persistPayload.mutateAsync({
      nextRules,
      nextProviders: providers,
    });
  };

  const handleDeleteRule = async (id: number) => {
    if (!confirm("确定删除这条出站规则吗？")) return;
    const nextRules = rawRules.filter((r) => r.id !== id);
    await persistPayload.mutateAsync({
      nextRules,
      nextProviders: providers,
    });
    toast.success("出站规则已删除");
  };

  const openAddRule = () => {
    setEditingRule(null);
    setNewKind("DOMAIN-SUFFIX");
    setNewValue("");
    setNewTarget("PROXY");
    setNewNoResolve(false);
    setRuleDialogOpen(true);
  };

  const openEditRule = (rule: Rule) => {
    setEditingRule(rule);
    setNewKind(rule.kind);
    setNewValue(rule.value);
    setNewTarget(rule.target);
    setNewNoResolve(rule.no_resolve);
    setRuleDialogOpen(true);
  };

  const saveRule = async () => {
    const value = newKind === "MATCH" ? "" : newValue.trim();
    const nextRule: Rule = editingRule
      ? {
          ...editingRule,
          kind: newKind,
          value,
          target: newTarget,
          target_override:
            editingRule.target_override || editingRule.target !== newTarget,
          no_resolve: newNoResolve,
        }
      : {
          id: -Date.now(),
          template_id: 0,
          kind: newKind,
          value,
          target: newTarget,
          base_target: newTarget,
          target_override: false,
          no_resolve: newNoResolve,
          position: rawRules.length,
          enabled: true,
        };
    await persistPayload.mutateAsync({
      nextRules: editingRule
        ? rawRules.map((rule) => (rule.id === editingRule.id ? nextRule : rule))
        : [...rawRules, nextRule],
      nextProviders: providers,
    });
    toast.success(editingRule ? "出站规则已更新" : "出站规则已添加");
    setRuleDialogOpen(false);
    setEditingRule(null);
    setNewValue("");
  };

  // 模板导入
  const importTemplateMutation = useMutation({
    mutationFn: () =>
      api.post("/api/templates", {
        url: templateUrl.trim(),
        content: templateContent.trim(),
      }),
    onSuccess: () => {
      toast.success("规则模板已成功导入！");
      setTemplateDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["currentRules"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      {/* 头部关于从模板加载 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-primary" />
            规则体系
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            统一管理流量识别、策略分组和出站路由
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setTemplateDialogOpen(true)}
        >
          <FileInput className="h-4 w-4" />
          从模板加载
        </Button>
      </div>

      {/* 3 个 Tab 导航：识别规则 -> 策略组 -> 出站规则 */}
      <Tabs
        value={activeTab}
        onValueChange={(tab) => setSearchParams({ tab }, { replace: true })}
      >
        <TabsList className="grid h-auto w-full grid-cols-3 p-1">
          <TabsTrigger value="recognition" className="gap-2">
            <Globe className="h-4 w-4" />
            识别规则（{providers.length}）
          </TabsTrigger>
          <TabsTrigger value="groups" className="gap-2">
            <Layers className="h-4 w-4" />
            策略组
          </TabsTrigger>
          <TabsTrigger value="outbound" className="gap-2">
            <Radio className="h-4 w-4" />
            出站规则（{rawRules.length}）
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recognition">
          <RecognitionRulesPanel
            providers={providers}
            onAdd={openAddProvider}
            onEdit={openEditProvider}
            onDelete={deleteProvider}
            onViewContent={(p) => setContentProvider(p)}
          />
        </TabsContent>

        <TabsContent value="groups">
          <GroupsPanel />
        </TabsContent>

        <TabsContent value="outbound">
          <OutboundRulesPanel
            rules={rawRules}
            targetOptions={targetOptions}
            onAddRule={openAddRule}
            onPreviewYaml={() => setPreviewModalOpen(true)}
            onDragEnd={handleDragEnd}
            onToggleRule={handleToggleRule}
            onEditRule={openEditRule}
            onDeleteRule={handleDeleteRule}
          />
        </TabsContent>
      </Tabs>

      {/* 识别规则编辑 Dialog */}
      <Dialog open={providerModalOpen} onOpenChange={setProviderModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProvider ? "修改识别规则" : "添加识别规则"}</DialogTitle>
            <DialogDescription>
              配置远程 MRS/规则集下载地址与自动刷新周期
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>规则集名称</Label>
              <Input
                placeholder="例如: Google / Telegram / Ads"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>下载地址 (URL)</Label>
              <Input
                placeholder="https://raw.githubusercontent.com/.../provider.mrs"
                value={providerUrl}
                onChange={(e) => setProviderUrl(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>识别类型 (Behavior)</Label>
                <Select
                  value={providerBehavior}
                  onChange={(e) => setProviderBehavior(e.target.value)}
                >
                  <option value="domain">域名匹配 (domain)</option>
                  <option value="ipcidr">IP 网段 (ipcidr)</option>
                  <option value="classical">混合 (classical)</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>更新间隔 (秒)</Label>
                <Input
                  type="number"
                  value={providerInterval}
                  onChange={(e) => setProviderInterval(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setProviderModalOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={saveProvider}>
              保存识别规则
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 查看识别规则词条 Dialog */}
      <Dialog open={!!contentProvider} onOpenChange={(v) => !v && setContentProvider(null)}>
        <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>识别规则内容: {contentProvider?.name}</DialogTitle>
            <DialogDescription>
              当前规则集包含的词条样本预览
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto rounded-xl bg-muted/40 border border-border/60 p-3 font-mono text-xs max-h-96">
            {providerContentQuery.isLoading ? (
              <div className="text-center py-8 text-muted-foreground">正在拉取词条内容…</div>
            ) : (providerContentQuery.data?.items ?? []).length > 0 ? (
              <div className="space-y-1">
                {providerContentQuery.data?.items.map((item, idx) => (
                  <div key={idx} className="truncate text-foreground/85">
                    {item}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                该识别规则暂无文本词条（或使用二进制 MRS 格式由内核直接加载）
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 出站规则编辑 Dialog */}
      <Dialog
        open={ruleDialogOpen}
        onOpenChange={(open) => {
          setRuleDialogOpen(open);
          if (!open) setEditingRule(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRule ? "编辑出站分流规则" : "添加出站分流规则"}</DialogTitle>
            <DialogDescription>
              配置匹配类型、匹配内容及目标出口；保存后立即写入当前规则集。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>识别规则 / 匹配类型 (Rule Kind)</Label>
              <Select value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k} ({KIND_LABELS[k] || k})
                  </option>
                ))}
              </Select>
            </div>

            {newKind === "RULE-SET" ? (
              <div className="space-y-1.5">
                <Label>选择引用的识别规则库</Label>
                <Select value={newValue} onChange={(e) => setNewValue(e.target.value)}>
                  <option value="">请选择规则集</option>
                  {providers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.behavior})
                    </option>
                  ))}
                </Select>
              </div>
            ) : newKind !== "MATCH" ? (
              <div className="space-y-1.5">
                <Label>匹配内容 (Value)</Label>
                <Input
                  placeholder="例如: google.com 或 192.168.1.0/24"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>处理方式 / 目标出口 (Target)</Label>
              <Select value={newTarget} onChange={(e) => setNewTarget(e.target.value)}>
                <option value="PROXY">PROXY (默认代理)</option>
                <option value="DIRECT">DIRECT (直连)</option>
                <option value="REJECT">REJECT (拦截拒绝)</option>
                {targetOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 p-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold">不解析 DNS (no-resolve)</div>
                <div className="text-[11px] text-muted-foreground">适用于 IP 网段类规则，避免额外 DNS 解析。</div>
              </div>
              <Switch checked={newNoResolve} onCheckedChange={setNewNoResolve} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRuleDialogOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={saveRule}
              disabled={newKind !== "MATCH" && !newValue.trim()}
            >
              {editingRule ? "保存修改" : "保存出站规则"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 从模板加载 Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>从模板加载规则 (ACL4SSR / Clash)</DialogTitle>
            <DialogDescription>
              填入远程规则模板 URL 或直接粘贴完整配置
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>远程模板 URL</Label>
              <Input
                placeholder="https://raw.githubusercontent.com/.../ACL4SSR_Online.ini"
                value={templateUrl}
                onChange={(e) => setTemplateUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>或者直接粘贴规则配置文本</Label>
              <Textarea
                placeholder="在此粘贴 rules 或 rule-providers 片段…"
                value={templateContent}
                onChange={(e) => setTemplateContent(e.target.value)}
                className="min-h-[140px] font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTemplateDialogOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => importTemplateMutation.mutate()}
              disabled={importTemplateMutation.isPending || (!templateUrl.trim() && !templateContent.trim())}
            >
              {importTemplateMutation.isPending ? "解析导入中…" : "立即解析导入"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 预览完整 YAML Dialog */}
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>预览生成配置 (config.yaml)</DialogTitle>
            <DialogDescription>
              根据当前识别规则、策略组及出站规则生成的完整 Mihomo YAML
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden rounded-xl border border-border/80 my-2">
            {previewQuery.data ? (
              <CodeMirror
                value={previewQuery.data.yaml}
                height="450px"
                extensions={[yaml()]}
                theme={oneDark}
                readOnly
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
                正在生成配置预览…
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
