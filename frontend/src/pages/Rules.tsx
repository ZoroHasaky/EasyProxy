import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  ArrowRight,
  Eye,
  FileUp,
  Layers,
  Pencil,
  Plus,
  Radio,
  ScrollText,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { api, autoApplyResultMessage, AutoApplyResponse, GenResult, GeoRecognitionGenerationResponse, GeoRecognitionPresetCatalog, mihomo, OutboundRule, proxyGroupTypeLabel, ProxyGroup, RecognitionRule, RecognitionRuleImportResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GroupsPanel } from "@/pages/Groups";
import { cn } from "@/lib/utils";

const RECOGNITION_KINDS = [
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
  "RULE-SET": "远程 YAML 规则集",
  MATCH: "最终兜底",
};

const BUILTIN_OUTBOUND_TARGETS = [
  { id: -1, name: "直连", target: "DIRECT", description: "不经过代理，直接连接目标" },
  { id: -2, name: "拒绝", target: "REJECT", description: "直接拒绝匹配到的连接" },
  { id: -3, name: "主代理出口", target: "PROXY", description: "由仪表盘的主代理出口选择决定最终出站" },
] as const;

function builtinOutboundTarget(id: number) {
  return BUILTIN_OUTBOUND_TARGETS.find((target) => target.id === id);
}

function proxySelectionLabel(selection?: string) {
  if (!selection) return "内核未运行或尚未选择";
  return selection === "AUTO" ? "自动测速（AUTO）" : selection;
}

function kindLabel(kind: string) {
  return `${KIND_LABELS[kind] ?? kind}（${kind}）`;
}

function RecognitionRulesPanel({
  rules,
  mappedRecognitionIDs,
  onAdd,
  onImport,
  onGenerateGeo,
  geoLoading,
  onEdit,
  onToggle,
  onDelete,
}: {
  rules: RecognitionRule[];
  mappedRecognitionIDs: Set<number>;
  onAdd: () => void;
  onImport: () => void;
  onGenerateGeo: () => void;
  geoLoading: boolean;
  onEdit: (rule: RecognitionRule) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (rule: RecognitionRule) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
            <ScrollText className="h-4.5 w-4.5 text-primary" />
            识别规则
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            每条规则可填写多个匹配条件；优先级数值越大，越早参与匹配。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onImport}>
            <FileUp className="h-4 w-4" />
            导入 YAML 规则源
          </Button>
          <Button variant="outline" size="sm" onClick={onGenerateGeo} disabled={geoLoading}>
            <WandSparkles className="h-4 w-4" />
            {geoLoading ? "检查 Geo 数据中…" : "根据 Geo 自动生成"}
          </Button>
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            新建识别规则
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rules.map((rule) => {
          const isRemoteSource = Boolean(rule.source_url);
          const preview = isRemoteSource
            ? `${rule.source_behavior ?? "domain"} · ${rule.source_url}`
            : rule.kind === "MATCH" ? "无条件，作为最终兜底" : rule.conditions.join("、");
          return (
            <div
              key={rule.id}
              className={cn(
                "flex min-h-56 flex-col justify-between rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur-sm transition-all hover:border-primary/40",
                !rule.enabled && "opacity-55",
              )}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{rule.name}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{kindLabel(rule.kind)}</div>
                  </div>
                  <Badge variant="purple" className="shrink-0 font-mono text-[10px]">
                    优先级 {rule.priority}
                  </Badge>
                </div>
                <div className="rounded-xl border border-border/50 bg-muted/35 p-3">
                  <div className="text-[11px] text-muted-foreground">{isRemoteSource ? `YAML 规则源 · 每 ${rule.source_interval ?? 86400} 秒更新` : `匹配条件（${rule.conditions.length}）`}</div>
                  <div className="mt-1.5 line-clamp-3 break-all font-mono text-xs" title={preview}>
                    {preview}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {mappedRecognitionIDs.has(rule.id) ? "已配置出站映射" : "尚未配置出站映射"}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3">
                <Switch checked={rule.enabled} onCheckedChange={(enabled) => onToggle(rule.id, enabled)} />
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onEdit(rule)}>
                    <Pencil className="h-3.5 w-3.5" /> 编辑
                  </Button>
                  <Button variant="ghost" size="iconSm" title="删除识别规则" onClick={() => onDelete(rule)}>
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {rules.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 py-12 text-center">
          <ScrollText className="mx-auto mb-2 h-10 w-10 text-muted-foreground/40" />
          <h4 className="text-sm font-semibold">暂无识别规则</h4>
          <p className="mt-1 text-xs text-muted-foreground">新建规则后，可在一条规则中填写多个域名、网段或其他匹配条件。</p>
        </div>
      )}
    </div>
  );
}

function OutboundRulesPanel({
  rules,
  recognitionRules,
  groups,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
  onPreview,
  proxySelection,
}: {
  rules: OutboundRule[];
  recognitionRules: RecognitionRule[];
  groups: ProxyGroup[];
  onAdd: () => void;
  onEdit: (rule: OutboundRule) => void;
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (rule: OutboundRule) => void;
  onPreview: () => void;
  proxySelection?: string;
}) {
  const recognitionByID = new Map(recognitionRules.map((rule) => [rule.id, rule]));
  const groupByID = new Map(groups.map((group) => [group.id, group]));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
            <Radio className="h-4.5 w-4.5 text-primary" />
            出站映射
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            绑定“识别规则 → 内置出站目标或节点组合”，决定最终的流量处理方式。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onPreview}>
            <Eye className="h-3.5 w-3.5" />
            预览 YAML
          </Button>
          <Button size="sm" onClick={onAdd} disabled={recognitionRules.length === 0}>
            <Plus className="h-4 w-4" />
            新建出站映射
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rules.map((rule) => {
          const recognition = recognitionByID.get(rule.recognition_id);
          const group = groupByID.get(rule.group_id);
          const builtinTarget = builtinOutboundTarget(rule.group_id);
          return (
            <div key={rule.id} className={cn("rounded-2xl border border-border/60 bg-card/60 p-4", !rule.enabled && "opacity-55")}>
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="font-mono text-[10px]">出站映射</Badge>
                <Switch checked={rule.enabled} onCheckedChange={(enabled) => onToggle(rule.id, enabled)} />
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-[11px] text-muted-foreground">识别规则</div>
                  <div className="mt-1 truncate text-sm font-semibold">{recognition?.name ?? "已删除的识别规则"}</div>
                  {recognition && <div className="mt-1 text-[11px] text-muted-foreground">{kindLabel(recognition.kind)} · 优先级 {recognition.priority}</div>}
                </div>
                <div className="flex items-center gap-2 text-primary"><ArrowRight className="h-4 w-4" /><span className="text-xs">{builtinTarget ? "交由内置目标处理" : "交由节点组合处理"}</span></div>
                <div>
                  <div className="text-[11px] text-muted-foreground">出站目标</div>
                  <div className="mt-1 truncate text-sm font-semibold text-primary">{builtinTarget ? `${builtinTarget.name}（${builtinTarget.target}）` : group?.name ?? "已删除的节点组合"}</div>
                  {builtinTarget ? <div className="mt-1 text-[11px] text-muted-foreground">{builtinTarget.target === "PROXY" ? `当前选择：${proxySelectionLabel(proxySelection)}` : builtinTarget.description}</div> : group && <div className="mt-1 text-[11px] text-muted-foreground">{proxyGroupTypeLabel(group.type)} · {group.member_mode === "manual" ? `手选 ${group.node_ids.length} 节点` : "按组合策略选择"}</div>}
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-1 border-t border-border/40 pt-3">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onEdit(rule)}><Pencil className="h-3.5 w-3.5" /> 编辑</Button>
                <Button variant="ghost" size="iconSm" title="删除出站映射" onClick={() => onDelete(rule)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button>
              </div>
            </div>
          );
        })}
      </div>

      {rules.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 py-12 text-center">
          <Radio className="mx-auto mb-2 h-10 w-10 text-muted-foreground/40" />
          <h4 className="text-sm font-semibold">暂无出站映射</h4>
          <p className="mt-1 text-xs text-muted-foreground">先创建识别规则，再绑定直连、拒绝、主代理出口或节点组合。</p>
        </div>
      )}
    </div>
  );
}

export default function RulesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const activeTab = ["recognition", "groups", "outbound"].includes(searchParams.get("tab") ?? "")
    ? searchParams.get("tab")!
    : "recognition";

  const recognitionQuery = useQuery({
    queryKey: ["recognitionRules"],
    queryFn: () => api.get<RecognitionRule[]>("/api/recognition-rules"),
  });
  const outboundQuery = useQuery({
    queryKey: ["outboundRules"],
    queryFn: () => api.get<OutboundRule[]>("/api/outbound-rules"),
  });
  const groupsQuery = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.get<ProxyGroup[]>("/api/groups"),
  });
  const proxiesQuery = useQuery({
    queryKey: ["proxies"],
    queryFn: () => mihomo.proxies(),
    refetchInterval: 10_000,
  });

  const [recognitionDialogOpen, setRecognitionDialogOpen] = useState(false);
  const [editingRecognition, setEditingRecognition] = useState<RecognitionRule | null>(null);
  const [recognitionName, setRecognitionName] = useState("");
  const [recognitionKind, setRecognitionKind] = useState("DOMAIN-SUFFIX");
  const [conditionsText, setConditionsText] = useState("");
  const [recognitionSourceURL, setRecognitionSourceURL] = useState("");
  const [recognitionSourceBehavior, setRecognitionSourceBehavior] = useState("domain");
  const [recognitionSourceInterval, setRecognitionSourceInterval] = useState(86400);
  const [recognitionPriority, setRecognitionPriority] = useState(0);
  const [recognitionEnabled, setRecognitionEnabled] = useState(true);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<"url" | "yaml">("url");
  const [importURL, setImportURL] = useState("");
  const [importName, setImportName] = useState("");
  const [importBehavior, setImportBehavior] = useState("domain");
  const [importInterval, setImportInterval] = useState(86400);
  const [importPriority, setImportPriority] = useState(0);
  const [importEnabled, setImportEnabled] = useState(true);
  const [importYAML, setImportYAML] = useState("");

  const [geoPresetDialogOpen, setGeoPresetDialogOpen] = useState(false);
  const [geoPresetCatalog, setGeoPresetCatalog] = useState<GeoRecognitionPresetCatalog | null>(null);
  const [selectedGeoPresetIDs, setSelectedGeoPresetIDs] = useState<string[]>([]);

  const [outboundDialogOpen, setOutboundDialogOpen] = useState(false);
  const [editingOutbound, setEditingOutbound] = useState<OutboundRule | null>(null);
  const [outboundRecognitionID, setOutboundRecognitionID] = useState(0);
  const [outboundGroupID, setOutboundGroupID] = useState(0);
  const [outboundEnabled, setOutboundEnabled] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  const previewQuery = useQuery({
    queryKey: ["configPreview"],
    queryFn: () => api.get<GenResult>("/api/config/preview"),
    enabled: previewOpen,
  });

  const recognitionRules = recognitionQuery.data ?? [];
  const outboundRules = outboundQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const importYAMLIsRuleFile = Boolean(importYAML.trim()) && !/^\s*rule-providers\s*:/m.test(importYAML);

  const reportAutoApply = (savedMessage: string, result: AutoApplyResponse) => {
    if (result.apply_error) {
      toast.warning(`${savedMessage}，但自动应用失败，已加入待应用清单`);
    } else {
      toast.success(`${savedMessage}，${autoApplyResultMessage(result.apply_result)}`);
    }
    qc.invalidateQueries({ queryKey: ["config-pending"] });
  };

  const saveRecognition = useMutation({
    mutationFn: (rules: RecognitionRule[]) => api.put<AutoApplyResponse>("/api/recognition-rules", rules),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recognitionRules"] });
      setRecognitionDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const saveOutbound = useMutation({
    mutationFn: (rules: OutboundRule[]) => api.put<AutoApplyResponse>("/api/outbound-rules", rules),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outboundRules"] });
      setOutboundDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const previewRecognitionImport = useMutation({
    mutationFn: () => api.post<RecognitionRuleImportResponse>("/api/recognition-rules/import", {
      content: importYAML,
      url: importURL,
      name: importName,
      behavior: importBehavior,
      interval: Number(importInterval) || 0,
      priority: Number(importPriority) || 0,
      enabled: importEnabled,
      preview: true,
    }),
    onError: (error: any) => toast.error(error.message),
  });
  const importRecognition = useMutation({
    mutationFn: () => api.post<RecognitionRuleImportResponse>("/api/recognition-rules/import", importMode === "url"
      ? {
          url: importURL,
          name: importName,
          behavior: importBehavior,
          interval: Number(importInterval) || 0,
          priority: Number(importPriority) || 0,
          enabled: importEnabled,
        }
      : {
          content: importYAML,
          url: importURL,
          name: importName,
          behavior: importBehavior,
          interval: Number(importInterval) || 0,
          priority: Number(importPriority) || 0,
          enabled: importEnabled,
        }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recognitionRules"] });
      setImportDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const loadGeoPresets = useMutation({
    mutationFn: () => api.get<GeoRecognitionPresetCatalog>("/api/recognition-rules/geo-presets"),
    onSuccess: (catalog) => {
      setGeoPresetCatalog(catalog);
      setSelectedGeoPresetIDs(catalog.presets.filter((preset) => preset.available).map((preset) => preset.id));
      setGeoPresetDialogOpen(true);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const generateGeoRecognition = useMutation({
    mutationFn: () => api.post<GeoRecognitionGenerationResponse>("/api/recognition-rules/generate-geo", { preset_ids: selectedGeoPresetIDs }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["recognitionRules"] });
      qc.invalidateQueries({ queryKey: ["config-pending"] });
      qc.invalidateQueries({ queryKey: ["configPreview"] });
      if (result.count > 0) {
        reportAutoApply(`已根据 Geo 数据生成 ${result.count} 条识别规则${result.skipped.length ? `，跳过 ${result.skipped.length} 条` : ""}`, result);
      } else {
        toast.info(`没有可新增的 Geo 识别规则，已跳过 ${result.skipped.length} 条`);
      }
      setGeoPresetDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const mappedRecognitionIDs = useMemo(
    () => new Set(outboundRules.map((rule) => rule.recognition_id)),
    [outboundRules],
  );

  const openAddRecognition = () => {
    setEditingRecognition(null);
    setRecognitionName("");
    setRecognitionKind("DOMAIN-SUFFIX");
    setConditionsText("");
    setRecognitionSourceURL("");
    setRecognitionSourceBehavior("domain");
    setRecognitionSourceInterval(86400);
    setRecognitionPriority(0);
    setRecognitionEnabled(true);
    setRecognitionDialogOpen(true);
  };

  const openEditRecognition = (rule: RecognitionRule) => {
    setEditingRecognition(rule);
    setRecognitionName(rule.name);
    setRecognitionKind(rule.kind);
    setConditionsText(rule.conditions.join("\n"));
    setRecognitionSourceURL(rule.source_url ?? "");
    setRecognitionSourceBehavior(rule.source_behavior ?? "domain");
    setRecognitionSourceInterval(rule.source_interval ?? 86400);
    setRecognitionPriority(rule.priority);
    setRecognitionEnabled(rule.enabled);
    setRecognitionDialogOpen(true);
  };

  const persistRecognition = async () => {
    const isRemoteSource = recognitionKind === "RULE-SET";
    const next: RecognitionRule = {
      id: editingRecognition?.id ?? -Date.now(),
      name: recognitionName.trim(),
      kind: recognitionKind,
      conditions: isRemoteSource ? [] : conditionsText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      source_url: isRemoteSource ? recognitionSourceURL.trim() : undefined,
      source_behavior: isRemoteSource ? recognitionSourceBehavior as "domain" | "ipcidr" | "classical" : undefined,
      source_interval: isRemoteSource ? Number(recognitionSourceInterval) || 0 : undefined,
      priority: Number(recognitionPriority) || 0,
      enabled: recognitionEnabled,
    };
    if (!next.name || (next.kind !== "MATCH" && !isRemoteSource && next.conditions.length === 0) || (isRemoteSource && !next.source_url)) {
      toast.error(isRemoteSource ? "请填写规则名称和 YAML 来源 URL" : "请填写规则名称和至少一个匹配条件");
      return;
    }
    const rules = editingRecognition
      ? recognitionRules.map((rule) => (rule.id === editingRecognition.id ? next : rule))
      : [...recognitionRules, next];
    const result = await saveRecognition.mutateAsync(rules);
    reportAutoApply(editingRecognition ? "识别规则已更新" : "识别规则已创建", result);
  };

  const openRecognitionImport = () => {
    setImportMode("url");
    setImportURL("");
    setImportName("");
    setImportBehavior("domain");
    setImportInterval(86400);
    setImportPriority(0);
    setImportEnabled(true);
    setImportYAML("");
    previewRecognitionImport.reset();
    setImportDialogOpen(true);
  };

  const openGeoPresetGenerator = () => {
    loadGeoPresets.mutate();
  };

  const toggleGeoPreset = (id: string, checked: boolean) => {
    setSelectedGeoPresetIDs((current) => checked
      ? [...current, id]
      : current.filter((item) => item !== id));
  };

  const persistRecognitionImport = async () => {
    const result = await importRecognition.mutateAsync();
    reportAutoApply(`已导入 ${result.count} 条 YAML 识别规则`, result);
  };

  const deleteRecognition = async (rule: RecognitionRule) => {
    if (!confirm(`确定删除识别规则「${rule.name}」吗？请先删除它关联的出站映射。`)) return;
    const result = await saveRecognition.mutateAsync(recognitionRules.filter((item) => item.id !== rule.id));
    reportAutoApply("识别规则已删除", result);
  };

  const toggleRecognition = (id: number, enabled: boolean) => {
    const rules = recognitionRules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule));
    void saveRecognition.mutateAsync(rules)
      .then((result) => reportAutoApply(enabled ? "识别规则已启用" : "识别规则已禁用", result))
      .catch(() => undefined);
  };

  const openAddOutbound = () => {
    const available = recognitionRules.find((rule) => !mappedRecognitionIDs.has(rule.id));
    setEditingOutbound(null);
    setOutboundRecognitionID(available?.id ?? 0);
    setOutboundGroupID(0);
    setOutboundEnabled(true);
    setOutboundDialogOpen(true);
  };

  const openEditOutbound = (rule: OutboundRule) => {
    setEditingOutbound(rule);
    setOutboundRecognitionID(rule.recognition_id);
    setOutboundGroupID(rule.group_id);
    setOutboundEnabled(rule.enabled);
    setOutboundDialogOpen(true);
  };

  const availableRecognitionRules = recognitionRules.filter(
    (rule) => !mappedRecognitionIDs.has(rule.id) || rule.id === editingOutbound?.recognition_id,
  );

  const persistOutbound = async () => {
    if (!outboundRecognitionID || !outboundGroupID) {
      toast.error("请选择识别规则和出站目标");
      return;
    }
    const next: OutboundRule = {
      id: editingOutbound?.id ?? -Date.now(),
      recognition_id: outboundRecognitionID,
      group_id: outboundGroupID,
      enabled: outboundEnabled,
    };
    const rules = editingOutbound
      ? outboundRules.map((rule) => (rule.id === editingOutbound.id ? next : rule))
      : [...outboundRules, next];
    const result = await saveOutbound.mutateAsync(rules);
    reportAutoApply(editingOutbound ? "出站映射已更新" : "出站映射已创建", result);
  };

  const deleteOutbound = async (rule: OutboundRule) => {
    if (!confirm("确定删除这条出站映射吗？")) return;
    const result = await saveOutbound.mutateAsync(outboundRules.filter((item) => item.id !== rule.id));
    reportAutoApply("出站映射已删除", result);
  };

  const toggleOutbound = (id: number, enabled: boolean) => {
    const rules = outboundRules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule));
    void saveOutbound.mutateAsync(rules)
      .then((result) => reportAutoApply(enabled ? "出站映射已启用" : "出站映射已禁用", result))
      .catch(() => undefined);
  };

  return (
    <div className="space-y-5">
      <Tabs value={activeTab} onValueChange={(tab) => setSearchParams({ tab }, { replace: true })}>
        <TabsList className="grid h-auto w-full grid-cols-3 p-1">
          <TabsTrigger value="recognition" className="gap-2"><ScrollText className="h-4 w-4" />识别规则（{recognitionRules.length}）</TabsTrigger>
          <TabsTrigger value="groups" className="gap-2"><Layers className="h-4 w-4" />节点组合（{groups.length}）</TabsTrigger>
          <TabsTrigger value="outbound" className="gap-2"><Radio className="h-4 w-4" />出站映射（{outboundRules.length}）</TabsTrigger>
        </TabsList>

        <TabsContent value="recognition">
          <RecognitionRulesPanel
            rules={recognitionRules}
            mappedRecognitionIDs={mappedRecognitionIDs}
            onAdd={openAddRecognition}
            onImport={openRecognitionImport}
            onGenerateGeo={openGeoPresetGenerator}
            geoLoading={loadGeoPresets.isPending}
            onEdit={openEditRecognition}
            onToggle={toggleRecognition}
            onDelete={deleteRecognition}
          />
        </TabsContent>
        <TabsContent value="groups"><GroupsPanel embedded /></TabsContent>
        <TabsContent value="outbound">
          <OutboundRulesPanel
            rules={outboundRules}
            recognitionRules={recognitionRules}
            groups={groups}
            onAdd={openAddOutbound}
            onEdit={openEditOutbound}
            onToggle={toggleOutbound}
            onDelete={deleteOutbound}
            onPreview={() => setPreviewOpen(true)}
            proxySelection={proxiesQuery.data?.proxies?.PROXY?.now}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={recognitionDialogOpen} onOpenChange={setRecognitionDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRecognition ? "编辑识别规则" : "新建识别规则"}</DialogTitle>
            <DialogDescription>同一识别规则可按行填写多个条件，生成时会展开为多条同优先级的 Mihomo 规则。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>名称</Label><Input value={recognitionName} onChange={(event) => setRecognitionName(event.target.value)} placeholder="例如：PT 站点" /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>识别范围</Label>
                <Select value={recognitionKind} onChange={(event) => setRecognitionKind(event.target.value)}>
                  {RECOGNITION_KINDS.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5"><Label>优先级</Label><Input type="number" value={recognitionPriority} onChange={(event) => setRecognitionPriority(Number(event.target.value))} /><p className="text-[11px] text-muted-foreground">默认 0，数字越大越优先。</p></div>
            </div>
            {recognitionKind === "RULE-SET" ? (
              <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">远程 YAML 规则集由 Mihomo 自动下载和更新；不支持 MRS 文件。</p>
                <div className="space-y-1.5"><Label>YAML 来源 URL</Label><Input value={recognitionSourceURL} onChange={(event) => setRecognitionSourceURL(event.target.value)} placeholder="https://example.com/rules.yaml" /></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>匹配类型</Label><Select value={recognitionSourceBehavior} onChange={(event) => setRecognitionSourceBehavior(event.target.value)}><option value="domain">域名（domain）</option><option value="ipcidr">IP 网段（ipcidr）</option><option value="classical">传统规则（classical）</option></Select></div>
                  <div className="space-y-1.5"><Label>更新周期（秒）</Label><Input type="number" min="1" value={recognitionSourceInterval} onChange={(event) => setRecognitionSourceInterval(Number(event.target.value))} /></div>
                </div>
              </div>
            ) : recognitionKind !== "MATCH" ? (
              <div className="space-y-1.5">
                <Label>匹配条件（每行一个）</Label>
                <Textarea value={conditionsText} onChange={(event) => setConditionsText(event.target.value)} className="min-h-36 font-mono text-xs" placeholder={recognitionKind === "DOMAIN-SUFFIX" ? "example.com\ntracker.example\nprivate.example" : "每行填写一个匹配条件"} />
              </div>
            ) : <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">MATCH 不需要条件，会匹配所有尚未命中的流量。请设置较低优先级，作为最终兜底。</div>}
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 p-3"><div><div className="text-xs font-semibold">启用此识别规则</div><div className="text-[11px] text-muted-foreground">禁用后不会写入 Mihomo 配置。</div></div><Switch checked={recognitionEnabled} onCheckedChange={setRecognitionEnabled} /></div>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setRecognitionDialogOpen(false)}>取消</Button><Button size="sm" onClick={persistRecognition} disabled={saveRecognition.isPending}>{saveRecognition.isPending ? "保存中…" : "保存识别规则"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>导入 YAML 识别规则源</DialogTitle>
            <DialogDescription>支持单个 YAML 地址、包含 rule-providers 的配置，以及 MetaCubeX 等来源的 payload 规则文件；请再在“出站映射”中决定实际节点组合。</DialogDescription>
          </DialogHeader>
          <Tabs value={importMode} onValueChange={(value) => { setImportMode(value as "url" | "yaml"); previewRecognitionImport.reset(); }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="url">单个 YAML URL</TabsTrigger>
              <TabsTrigger value="yaml">粘贴 YAML 配置</TabsTrigger>
            </TabsList>
            <TabsContent value="url" className="space-y-4 py-3">
              <div className="space-y-1.5"><Label>YAML 文件 URL</Label><Input value={importURL} onChange={(event) => setImportURL(event.target.value)} placeholder="https://raw.githubusercontent.com/.../apple.yaml" /></div>
              <div className="space-y-1.5"><Label>名称（可选）</Label><Input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="留空时从 YAML 文件名推导" /></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>匹配类型</Label><Select value={importBehavior} onChange={(event) => setImportBehavior(event.target.value)}><option value="domain">域名（domain）</option><option value="ipcidr">IP 网段（ipcidr）</option><option value="classical">传统规则（classical）</option></Select></div>
                <div className="space-y-1.5"><Label>更新周期（秒）</Label><Input type="number" min="1" value={importInterval} onChange={(event) => setImportInterval(Number(event.target.value))} /></div>
              </div>
            </TabsContent>
            <TabsContent value="yaml" className="space-y-3 py-3">
              <div className="space-y-1.5"><Label>YAML 配置或规则文件</Label><Textarea value={importYAML} onChange={(event) => { setImportYAML(event.target.value); previewRecognitionImport.reset(); }} className="min-h-52 font-mono text-xs" placeholder={'批量配置：\nrule-providers:\n  apple:\n    type: http\n    behavior: domain\n    url: https://example.com/apple.yaml\n    format: yaml\n\n或粘贴单个规则文件：\npayload:\n  - +.github.com'} /></div>
              {importYAMLIsRuleFile && <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">检测到单个 <code className="font-mono">payload</code> 规则文件。请填写它的远程来源，Mihomo 会从该地址自动更新规则。</p>
                <div className="space-y-1.5"><Label>规则文件 URL</Label><Input value={importURL} onChange={(event) => { setImportURL(event.target.value); previewRecognitionImport.reset(); }} placeholder="https://github.com/.../blob/.../github.yaml" /></div>
                <div className="space-y-1.5"><Label>名称（可选）</Label><Input value={importName} onChange={(event) => { setImportName(event.target.value); previewRecognitionImport.reset(); }} placeholder="留空时从 YAML 文件名推导" /></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label>匹配类型</Label><Select value={importBehavior} onChange={(event) => { setImportBehavior(event.target.value); previewRecognitionImport.reset(); }}><option value="domain">域名（domain）</option><option value="ipcidr">IP 网段（ipcidr）</option><option value="classical">传统规则（classical）</option></Select></div>
                  <div className="space-y-1.5"><Label>更新周期（秒）</Label><Input type="number" min="1" value={importInterval} onChange={(event) => { setImportInterval(Number(event.target.value)); previewRecognitionImport.reset(); }} /></div>
                </div>
              </div>}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/35 p-3">
                <div className="text-xs text-muted-foreground">批量配置会读取其中的来源信息；单个规则文件会校验 payload，并使用上方填写的来源。下载路径由 EasyProxy 自动生成。</div>
                <Button type="button" variant="outline" size="sm" onClick={() => previewRecognitionImport.mutate()} disabled={!importYAML.trim() || (importYAMLIsRuleFile && !importURL.trim()) || previewRecognitionImport.isPending}><Eye className="h-3.5 w-3.5" />{previewRecognitionImport.isPending ? "解析中…" : "解析配置"}</Button>
              </div>
              {previewRecognitionImport.data && <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-3 text-xs text-emerald-700 dark:text-emerald-300">已解析 {previewRecognitionImport.data.count} 个规则源：{previewRecognitionImport.data.rules.map((rule) => rule.name).join("、")}</div>}
            </TabsContent>
          </Tabs>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>优先级</Label><Input type="number" value={importPriority} onChange={(event) => setImportPriority(Number(event.target.value))} /><p className="text-[11px] text-muted-foreground">默认 0，数字越大越先匹配。</p></div>
            <div className="flex items-center justify-between self-end rounded-xl border border-border/60 bg-muted/40 p-3"><div><div className="text-xs font-semibold">导入后启用</div><div className="text-[11px] text-muted-foreground">未映射前不会写入内核配置。</div></div><Switch checked={importEnabled} onCheckedChange={setImportEnabled} /></div>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setImportDialogOpen(false)}>取消</Button><Button size="sm" onClick={persistRecognitionImport} disabled={importRecognition.isPending || (importMode === "url" ? !importURL.trim() : !previewRecognitionImport.data)}>{importRecognition.isPending ? "导入中…" : "导入识别规则"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={geoPresetDialogOpen} onOpenChange={setGeoPresetDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>根据 Geo 自动生成识别规则</DialogTitle>
            <DialogDescription>仅根据本地已拉取且可解析的 Geo 数据生成规则。生成后还需在“出站映射”中绑定节点组合，当前流量不会因此改变。</DialogDescription>
          </DialogHeader>
          {!geoPresetCatalog?.available ? (
            <div className="space-y-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{geoPresetCatalog?.message || "未检测到可用 Geo 数据"}</p>
              <p className="text-xs text-muted-foreground">请先在 Geo 数据页面启用 Geo 数据、应用配置并手动更新，然后再回来生成识别规则。</p>
              <Button size="sm" onClick={() => { setGeoPresetDialogOpen(false); navigate("/geo"); }}><WandSparkles className="h-4 w-4" />前往 Geo 数据</Button>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">已默认选中当前数据中可用的日常规则。所有新规则均启用，优先级为 1；已存在相同条件或名称冲突的规则会在生成时自动跳过。</div>
              {(["GEOIP", "GEOSITE"] as const).map((kind) => {
                const presets = geoPresetCatalog.presets.filter((preset) => preset.kind === kind);
                return <div key={kind} className="space-y-2">
                  <div className="text-xs font-semibold">{kindLabel(kind)}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {presets.map((preset) => {
                      const checked = selectedGeoPresetIDs.includes(preset.id);
                      return <label key={preset.id} className={cn("flex cursor-pointer items-start gap-2 rounded-xl border p-3 transition-colors", preset.available ? "border-border/60 bg-muted/35 hover:border-primary/40" : "cursor-not-allowed border-border/40 bg-muted/20 opacity-55")}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={checked} disabled={!preset.available} onChange={(event) => toggleGeoPreset(preset.id, event.target.checked)} />
                        <span className="min-w-0"><span className="block text-xs font-semibold">{preset.name}</span><span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{preset.kind},{preset.condition}</span>{!preset.available && <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-300">{preset.reason}</span>}</span>
                      </label>;
                    })}
                  </div>
                </div>;
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setGeoPresetDialogOpen(false)}>取消</Button>
            {geoPresetCatalog?.available && <Button size="sm" onClick={() => generateGeoRecognition.mutate()} disabled={selectedGeoPresetIDs.length === 0 || generateGeoRecognition.isPending}>{generateGeoRecognition.isPending ? "生成中…" : `生成 ${selectedGeoPresetIDs.length} 条规则`}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={outboundDialogOpen} onOpenChange={setOutboundDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingOutbound ? "编辑出站映射" : "新建出站映射"}</DialogTitle><DialogDescription>将一条识别规则交给内置出站目标或节点组合，决定最终的流量处理方式。</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>识别规则</Label><Select value={String(outboundRecognitionID)} onChange={(event) => setOutboundRecognitionID(Number(event.target.value))}><option value="0">请选择识别规则</option>{availableRecognitionRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}（{rule.kind}，优先级 {rule.priority}）</option>)}</Select></div>
            <div className="space-y-1.5"><Label>出站目标</Label><Select value={String(outboundGroupID)} onChange={(event) => setOutboundGroupID(Number(event.target.value))}><option value="0">请选择出站目标</option><optgroup label="内置出站目标">{BUILTIN_OUTBOUND_TARGETS.map((target) => <option key={target.id} value={target.id}>{target.name}（{target.target}）</option>)}</optgroup><optgroup label="节点组合">{groups.map((group) => <option key={group.id} value={group.id}>{group.name}（{proxyGroupTypeLabel(group.type)}{group.enabled ? "" : "，已禁用"}）</option>)}</optgroup></Select></div>
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 p-3"><div><div className="text-xs font-semibold">启用此出站映射</div><div className="text-[11px] text-muted-foreground">关闭后该识别规则不参与路由。</div></div><Switch checked={outboundEnabled} onCheckedChange={setOutboundEnabled} /></div>
          </div>
          <DialogFooter><Button variant="outline" size="sm" onClick={() => setOutboundDialogOpen(false)}>取消</Button><Button size="sm" onClick={persistOutbound} disabled={saveOutbound.isPending}>{saveOutbound.isPending ? "保存中…" : "保存出站映射"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl"><DialogHeader><DialogTitle>预览生成配置</DialogTitle><DialogDescription>识别规则会按照优先级从大到小展开，然后映射到相应节点组合。</DialogDescription></DialogHeader><div className="my-2 flex-1 overflow-hidden rounded-xl border border-border/80">{previewQuery.data ? <CodeMirror value={previewQuery.data.yaml} height="450px" extensions={[yaml()]} theme={oneDark} readOnly /> : <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">正在生成配置…</div>}</div></DialogContent>
      </Dialog>
    </div>
  );
}
