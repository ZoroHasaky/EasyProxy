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
  verticalListSortingStrategy,
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
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
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
import { cn } from "@/lib/utils";
import { GroupsPanel } from "@/pages/Groups";

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
  "RULE-SET": "规则集",
  MATCH: "最终兜底",
};
const KIND_PLACEHOLDERS: Record<string, string> = {
  DOMAIN: "例如 example.com",
  "DOMAIN-SUFFIX": "例如 example.com",
  "DOMAIN-KEYWORD": "例如 google",
  "DOMAIN-REGEX": "输入正则表达式",
  "IP-CIDR": "例如 192.168.0.0/16",
  "IP-CIDR6": "例如 2001:db8::/32",
  GEOIP: "例如 CN",
  GEOSITE: "例如 category-ads-all",
  "SRC-IP-CIDR": "来源 IP 网段",
  "SRC-PORT": "例如 7890",
  "DST-PORT": "例如 443",
  "PROCESS-NAME": "例如 chrome.exe",
  "PROCESS-PATH": "输入完整进程路径",
  "IN-TYPE": "例如 TUN",
};
const BUILTIN_TARGETS = [
  "PROXY",
  "AUTO",
  "DIRECT",
  "REJECT",
  "REJECT-DROP",
  "PASS",
];
const BUILTIN_TARGET_LABELS: Record<string, string> = {
  PROXY: "代理",
  AUTO: "自动选择",
  DIRECT: "直连",
  REJECT: "拒绝",
  "REJECT-DROP": "拒绝并丢弃",
  PASS: "继续匹配",
};
const BEHAVIOR_LABELS: Record<string, string> = {
  domain: "域名",
  ipcidr: "IP 网段",
  classical: "经典规则",
};
const STATUS_LABELS: Record<string, string> = {
  downloaded: "已下载",
  not_downloaded: "未下载",
  not_loaded: "未加载当前配置",
  core_stopped: "内核未运行",
  unknown: "状态未知",
};

function targetLabel(target: string) {
  return BUILTIN_TARGET_LABELS[target] ?? target;
}
function kindLabel(kind: string) {
  return `${KIND_LABELS[kind] ?? kind}（${kind}）`;
}
function providerStatusLabel(status?: string) {
  return STATUS_LABELS[status ?? "unknown"] ?? "状态未知";
}
function providerStatusVariant(
  status?: string,
): "success" | "warning" | "secondary" | "outline" {
  if (status === "downloaded") return "success";
  if (status === "not_downloaded") return "warning";
  if (status === "not_loaded" || status === "core_stopped") return "secondary";
  return "outline";
}
function optionLabel(option: RuleTargetOption) {
  const icon = option.icon ? `${option.icon} ` : "";
  if (option.kind === "node")
    return `${icon}${option.name}${option.source_name ? ` · ${option.source_name}` : ""}`;
  return `${icon}${option.name}（${option.member_count ?? 0} 节点${option.available ? "" : "，不可用"}）`;
}
function findTargetOption(target: string, options: RuleTargetOption[]) {
  return (
    options.find((option) => option.value === target) ??
    options.find((option) => option.name === target)
  );
}
function normalizedTarget(target: string, options: RuleTargetOption[]) {
  return findTargetOption(target, options)?.value ?? target;
}

function TargetOptions({ options }: { options: RuleTargetOption[] }) {
  const groups = (kind: RuleTargetOption["kind"]) =>
    options.filter((option) => option.kind === kind);
  return (
    <>
      <optgroup label="内置动作">
        {BUILTIN_TARGETS.map((target) => (
          <option key={target} value={target}>
            {targetLabel(target)}
          </option>
        ))}
      </optgroup>
      {groups("region_group").length > 0 && (
        <optgroup label="地区策略组">
          {groups("region_group").map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={!option.available}
            >
              {optionLabel(option)}
            </option>
          ))}
        </optgroup>
      )}
      {groups("group").length > 0 && (
        <optgroup label="其他策略组">
          {groups("group").map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={!option.available}
            >
              {optionLabel(option)}
            </option>
          ))}
        </optgroup>
      )}
      {groups("node").length > 0 && (
        <optgroup label="指定节点">
          {groups("node").map((option) => (
            <option key={option.value} value={option.value}>
              {optionLabel(option)}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

function RuleRow({
  rule,
  providers,
  targetOptions,
  onEdit,
  onDelete,
  onViewProvider,
  dragged,
}: {
  rule: Rule;
  providers: RuleProvider[];
  targetOptions: RuleTargetOption[];
  onEdit: () => void;
  onDelete: () => void;
  onViewProvider: (provider: RuleProvider) => void;
  dragged: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule.id });
  const matchedTarget = findTargetOption(rule.target, targetOptions);
  const targetAvailable =
    BUILTIN_TARGETS.includes(rule.target) || matchedTarget?.available === true;
  const provider = providers.find((item) => item.name === rule.value);
  const displayTarget = BUILTIN_TARGETS.includes(rule.target)
    ? targetLabel(rule.target)
    : matchedTarget
      ? optionLabel(matchedTarget)
      : `${rule.target}（目标已失效）`;
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={cn(
        "grid min-w-[980px] grid-cols-[24px_64px_190px_minmax(220px,1fr)_230px_110px_100px] items-center gap-2 border-b px-3 py-2 text-sm hover:bg-muted/30",
        dragged && "ring-1 ring-emerald-600",
      )}
    >
      <button
        className="cursor-grab text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Badge variant={rule.enabled ? "success" : "secondary"} className="w-fit">
        {rule.enabled ? "启用" : "停用"}
      </Badge>
      <span>{kindLabel(rule.kind)}</span>
      <div className="min-w-0">
        {rule.kind === "MATCH" ? (
          <span className="text-muted-foreground">命中此前未匹配的所有流量</span>
        ) : rule.kind === "RULE-SET" ? (
          <div className="flex items-center gap-2">
            <span className={cn("truncate", !provider && "text-destructive")}>
              {provider
                ? `${provider.name} · ${BEHAVIOR_LABELS[provider.behavior] ?? provider.behavior} · ${providerStatusLabel(provider.status)}`
                : `${rule.value || "未选择"}（识别规则已失效）`}
            </span>
            {provider && (
              <Button
                size="icon"
                variant="ghost"
                title="查看识别规则详情"
                onClick={() => onViewProvider(provider)}
              >
                <Info className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <span className="break-all font-mono text-xs">{rule.value}</span>
        )}
      </div>
      <div>
        <div className={cn("truncate", !targetAvailable && "text-destructive")}>
          {displayTarget}
        </div>
        {rule.target_override && (
          <div className="mt-1 text-xs text-amber-700">
            已覆盖加载时的处理方式
          </div>
        )}
        {!targetAvailable && (
          <div className="mt-1 text-xs text-destructive">
            目标失效，应用时回退代理
          </div>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {rule.no_resolve ? "跳过 DNS 解析" : "正常解析"}
      </span>
      <div className="flex items-center justify-end gap-1">
        <Button
          size="icon"
          variant="ghost"
          title="修改代理规则"
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="删除代理规则"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

export default function RulesPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [providers, setProviders] = useState<RuleProvider[] | null>(null);
  const [providerDraft, setProviderDraft] = useState<RuleProvider | null>(null);
  const [providerDraftIsNew, setProviderDraftIsNew] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<Rule | null>(null);
  const [ruleDraftIsNew, setRuleDraftIsNew] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [templateURL, setTemplateURL] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [templatePreview, setTemplatePreview] =
    useState<RuleTemplatePreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [detailProvider, setDetailProvider] = useState<RuleProvider | null>(
    null,
  );
  const [contentInput, setContentInput] = useState("");
  const [contentQuery, setContentQuery] = useState("");
  const [contentPage, setContentPage] = useState(1);
  const [dragId, setDragId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const payload = useQuery({
    queryKey: ["rules"],
    queryFn: () => api.get<RulesPayload>("/api/rules"),
    refetchInterval: 15000,
  });
  const ruleTargets = useQuery({
    queryKey: ["ruleTargets"],
    queryFn: () => api.get<RuleTargetOption[]>("/api/rule-targets"),
  });
  const preview = useQuery({
    queryKey: ["preview"],
    queryFn: () => api.get<GenResult>("/api/config/preview"),
    enabled: previewOpen,
  });
  const providerContent = useQuery({
    queryKey: [
      "providerContent",
      detailProvider?.id,
      contentQuery,
      contentPage,
    ],
    queryFn: () =>
      api.get<RuleProviderContent>(
        `/api/rule-providers/${detailProvider!.id}/content?q=${encodeURIComponent(contentQuery)}&page=${contentPage}&size=100`,
      ),
    enabled:
      !!detailProvider &&
      detailProvider.id > 0 &&
      detailProvider.format !== "mrs",
  });

  useEffect(() => {
    if (!payload.data) return;
    setRules(
      (current) => current ?? payload.data!.rules.map((rule) => ({ ...rule })),
    );
    setProviders((current) => {
      if (current === null)
        return payload.data!.providers.map((provider) => ({ ...provider }));
      const runtime = new Map(
        payload.data!.providers.map((provider) => [provider.id, provider]),
      );
      return current.map((provider) => {
        const fresh = runtime.get(provider.id);
        const unchanged =
          fresh &&
          ["name", "url", "behavior", "format", "interval"].every(
            (key) => (fresh as any)[key] === (provider as any)[key],
          );
        return unchanged
          ? {
              ...provider,
              status: fresh!.status,
              rule_count: fresh!.rule_count,
            }
          : provider;
      });
    });
  }, [payload.data]);

  const localRules = rules ?? [];
  const localProviders = providers ?? [];
  const targetOptions = ruleTargets.data ?? [];
  const validationError = (
    nextRules = localRules,
    nextProviders = localProviders,
  ) => {
    const names = new Set<string>();
    for (const provider of nextProviders) {
      const name = provider.name.trim();
      if (!name || !provider.url.trim()) return "识别规则的名称和 URL 不能为空";
      if (provider.format !== "mrs")
        return `识别规则“${name}”使用旧格式 ${provider.format.toUpperCase()}，请修改为 MRS`;
      if (/[,\r\n]/.test(name))
        return `识别规则名称不能包含逗号或换行：${name}`;
      if (names.has(name)) return `识别规则名称重复：${name}`;
      names.add(name);
    }
    for (const rule of nextRules) {
      if (!rule.kind || !rule.target) return "存在缺少规则类型或处理方式的规则";
      if (rule.kind === "RULE-SET" && !names.has(rule.value))
        return `代理规则引用了不存在的识别规则：${rule.value || "未选择"}`;
    }
    return "";
  };
  const reloadFromServer = async () => {
    const fresh = await api.get<RulesPayload>("/api/rules");
    qc.setQueryData(["rules"], fresh);
    setRules(fresh.rules.map((rule) => ({ ...rule })));
    setProviders(fresh.providers.map((provider) => ({ ...provider })));
    qc.invalidateQueries({ queryKey: ["preview"] });
  };

  const saveRules = useMutation({
    mutationFn: ({
      nextRules,
      nextProviders,
    }: {
      nextRules: Rule[];
      nextProviders: RuleProvider[];
    }) => api.put("/api/rules", { rules: nextRules, providers: nextProviders }),
    onError: (error: any) => toast.error(error.message),
  });
  const persistRules = async (
    nextRules: Rule[],
    nextProviders: RuleProvider[],
    message: string,
  ) => {
    const error = validationError(nextRules, nextProviders);
    if (error) {
      toast.error(error);
      return false;
    }
    try {
      await saveRules.mutateAsync({ nextRules, nextProviders });
      toast.success(`${message}（记得应用配置）`);
      await reloadFromServer();
      return true;
    } catch {
      await reloadFromServer();
      return false;
    }
  };
  const parseTemplate = useMutation({
    mutationFn: () =>
      api.post<RuleTemplatePreview>("/api/rules/template-preview", {
        url: templateURL.trim() || undefined,
        content: templateURL.trim() ? undefined : templateContent,
      }),
    onSuccess: (data) => {
      setTemplatePreview(data);
      setMapping({ ...data.mapping });
    },
    onError: (error: any) => toast.error(error.message),
  });
  const loadTemplate = useMutation({
    mutationFn: () => {
      const loadedRules = (templatePreview?.rules ?? []).map((rule, index) => {
        const target = BUILTIN_TARGETS.includes(rule.target)
          ? rule.target
          : mapping[rule.target] || "PROXY";
        return {
          ...rule,
          id: -(index + 1),
          template_id: 0,
          target,
          base_target: target,
          target_override: false,
        };
      });
      const loadedProviders = (templatePreview?.providers ?? []).map(
        (provider, index) => ({
          ...provider,
          id: -(index + 1),
          template_id: 0,
        }),
      );
      const error = validationError(loadedRules, loadedProviders);
      if (error) throw new Error(error);
      return api.put("/api/rules", {
        rules: loadedRules,
        providers: loadedProviders,
      });
    },
    onSuccess: () => {
      toast.success("已从模板提取并覆盖当前规则");
      setLoadOpen(false);
      setTemplateURL("");
      setTemplateContent("");
      setTemplatePreview(null);
      setMapping({});
      void reloadFromServer();
    },
    onError: (error: any) => toast.error(error.message),
  });
  const saveAndPreview = useMutation({
    mutationFn: async () => {
      await api.put("/api/rules", {
        rules: localRules,
        providers: localProviders,
      });
      return api.get<GenResult>("/api/config/preview");
    },
    onSuccess: (data) => {
      qc.setQueryData(["preview"], data);
      setPreviewOpen(true);
      void reloadFromServer();
    },
    onError: (error: any) => toast.error(error.message),
  });
  const saveAndApply = useMutation({
    mutationFn: async () => {
      await api.put("/api/rules", {
        rules: localRules,
        providers: localProviders,
      });
      return api.post<{ result: string }>("/api/config/apply");
    },
    onSuccess: (result) => {
      toast.success(
        `配置已应用（${result.result === "reloaded" ? "热重载" : result.result === "restarted" ? "已重启内核" : result.result}）`,
      );
      setPreviewOpen(false);
      void reloadFromServer();
    },
    onError: (error: any) => toast.error(error.message),
  });
  const validateThen = (action: () => void) => {
    const error = validationError();
    if (error) toast.error(error);
    else action();
  };

  const openAddProvider = () => {
    setProviderDraftIsNew(true);
    setProviderDraft({
      id: -Date.now(),
      template_id: 0,
      name: "",
      url: "",
      behavior: "domain",
      format: "mrs",
      interval: 86400,
      status: "not_loaded",
    });
  };
  const openEditProvider = (provider: RuleProvider) => {
    setProviderDraftIsNew(false);
    setProviderDraft({ ...provider });
  };
  const commitProviderDraft = async () => {
    if (!providerDraft) return;
    const next = {
      ...providerDraft,
      name: providerDraft.name.trim(),
      url: providerDraft.url.trim(),
      interval: providerDraft.interval || 86400,
      status: "not_loaded" as const,
    };
    if (!next.name || !next.url) {
      toast.error("识别规则的名称和 URL 不能为空");
      return;
    }
    if (next.format !== "mrs") {
      toast.error("识别规则仅支持 MRS 格式，请修改格式和下载地址");
      return;
    }
    if (/[,\r\n]/.test(next.name)) {
      toast.error("识别规则名称不能包含逗号或换行");
      return;
    }
    if (
      localProviders.some(
        (provider) => provider.id !== next.id && provider.name === next.name,
      )
    ) {
      toast.error(`识别规则名称重复：${next.name}`);
      return;
    }
    const existing = localProviders.find((provider) => provider.id === next.id);
    const nextRules =
      existing && next.name !== existing.name
        ? localRules.map((rule) =>
            rule.kind === "RULE-SET" && rule.value === existing.name
              ? { ...rule, value: next.name }
              : rule,
          )
        : localRules;
    const nextProviders =
      providerDraftIsNew
        ? [...localProviders, next]
        : localProviders.map((provider) =>
            provider.id === next.id ? next : provider,
          );
    if (
      await persistRules(
        nextRules,
        nextProviders,
        providerDraftIsNew ? "识别规则已添加" : "识别规则已修改",
      )
    ) {
      setProviderDraft(null);
    }
  };
  const deleteProvider = async (provider: RuleProvider) => {
    const references = localRules.filter(
      (rule) => rule.kind === "RULE-SET" && rule.value === provider.name,
    ).length;
    if (references > 0) {
      toast.error(
        `“${provider.name}”仍被 ${references} 条代理规则引用，不能删除`,
      );
      return;
    }
    if (!confirm(`确定删除识别规则“${provider.name}”？`)) return;
    await persistRules(
      localRules,
      localProviders.filter((item) => item.id !== provider.id),
      "识别规则已删除",
    );
  };
  const openAddRule = () => {
    setRuleDraftIsNew(true);
    setRuleDraft({
      id: -Date.now(),
      template_id: 0,
      kind: "DOMAIN-SUFFIX",
      value: "",
      target: "PROXY",
      base_target: "PROXY",
      target_override: false,
      no_resolve: false,
      position: 0,
      enabled: true,
    });
  };
  const openEditRule = (rule: Rule) => {
    setRuleDraftIsNew(false);
    setRuleDraft({ ...rule });
  };
  const commitRuleDraft = async () => {
    if (!ruleDraft) return;
    const next = {
      ...ruleDraft,
      value: ruleDraft.kind === "MATCH" ? "" : ruleDraft.value.trim(),
    };
    if (!next.kind || !next.target) {
      toast.error("规则类型和处理方式不能为空");
      return;
    }
    if (next.kind !== "MATCH" && !next.value) {
      toast.error("匹配内容不能为空");
      return;
    }
    if (
      next.kind === "RULE-SET" &&
      !localProviders.some((provider) => provider.name === next.value)
    ) {
      toast.error("请选择有效的识别规则");
      return;
    }
    const nextRules =
      ruleDraftIsNew
        ? [...localRules, next]
        : localRules.map((rule) => (rule.id === next.id ? next : rule));
    if (
      await persistRules(
        nextRules,
        localProviders,
        ruleDraftIsNew ? "代理规则已添加" : "代理规则已修改",
      )
    ) {
      setRuleDraft(null);
    }
  };
  const deleteRule = async (rule: Rule) => {
    if (!confirm("确定删除这条代理规则？")) return;
    await persistRules(
      localRules.filter((item) => item.id !== rule.id),
      localProviders,
      "代理规则已删除",
    );
  };
  const onDragEnd = async (event: DragEndEvent) => {
    setDragId(null);
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = localRules.findIndex(
      (rule) => rule.id === event.active.id,
    );
    const newIndex = localRules.findIndex((rule) => rule.id === event.over!.id);
    if (oldIndex >= 0 && newIndex >= 0) {
      const nextRules = arrayMove(localRules, oldIndex, newIndex);
      setRules(nextRules);
      await persistRules(nextRules, localProviders, "代理规则顺序已保存");
    }
  };
  const openProviderDetail = (provider: RuleProvider) => {
    const saved = payload.data?.providers.find(
      (item) => item.id === provider.id,
    );
    const unchanged =
      saved &&
      ["name", "url", "behavior", "format", "interval"].every(
        (key) => (saved as any)[key] === (provider as any)[key],
      );
    if (provider.format !== "mrs" && (!saved || !unchanged)) {
      toast.error("请先保存识别规则，再查看实际内容");
      return;
    }
    setContentInput("");
    setContentQuery("");
    setContentPage(1);
    setDetailProvider(provider);
  };
  const closeTemplateLoader = () => {
    setLoadOpen(false);
    setTemplateURL("");
    setTemplateContent("");
    setTemplatePreview(null);
    setMapping({});
  };
  const pageCount = Math.max(
    1,
    Math.ceil((providerContent.data?.total ?? 0) / 100),
  );
  const requestedTab = searchParams.get("tab");
  const activeTab = ["recognition", "proxy", "groups"].includes(
    requestedTab ?? "",
  )
    ? requestedTab!
    : "proxy";
  const ruleDraftBaseTarget = ruleDraft
    ? normalizedTarget(ruleDraft.base_target || ruleDraft.target, targetOptions)
    : "PROXY";
  const ruleDraftTarget = ruleDraft
    ? normalizedTarget(ruleDraft.target, targetOptions)
    : "PROXY";
  const ruleDraftMatchedTarget = ruleDraft
    ? findTargetOption(ruleDraft.target, targetOptions)
    : undefined;
  const templateHasUnsupportedFormats =
    templatePreview?.providers.some((provider) => provider.format !== "mrs") ??
    false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">规则</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            统一管理流量识别、代理处理和策略组。
          </p>
        </div>
        {activeTab !== "groups" && (
          <Button onClick={() => setLoadOpen(true)}>
            <FileInput className="h-4 w-4" /> 从模板加载
          </Button>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(tab) => setSearchParams({ tab }, { replace: true })}
      >
        <TabsList className="grid h-auto w-full grid-cols-3 p-1">
          <TabsTrigger value="recognition">
            识别规则（{localProviders.length}）
          </TabsTrigger>
          <TabsTrigger value="groups">策略组</TabsTrigger>
          <TabsTrigger value="proxy">
            代理规则（{localRules.length}）
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recognition" className="mt-4">
          <div className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
              <div>
                <div className="text-sm font-medium">
                  识别规则（{localProviders.length}）
                </div>
                <div className="text-xs text-muted-foreground">
                  仅支持远程 MRS 规则文件，必须填写可直接下载的 HTTP/HTTPS
                  地址，供代理规则中的 RULE-SET 引用。
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={openAddProvider}>
                  <Plus className="h-3.5 w-3.5" /> 添加识别规则
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                <div className="grid grid-cols-[150px_120px_90px_100px_minmax(250px,1fr)_130px_120px] gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>名称</span>
                  <span>匹配类型</span>
                  <span>格式</span>
                  <span>更新间隔</span>
                  <span>下载地址</span>
                  <span>下载状态</span>
                  <span className="text-right">操作</span>
                </div>
                {localProviders.map((provider) => (
                  <div
                    key={provider.id}
                    className="grid grid-cols-[150px_120px_90px_100px_minmax(250px,1fr)_130px_120px] items-center gap-2 border-b px-3 py-2"
                  >
                    <span className="truncate font-medium" title={provider.name}>
                      {provider.name}
                    </span>
                    <span>
                      {BEHAVIOR_LABELS[provider.behavior] ?? provider.behavior}
                    </span>
                    <span>{provider.format.toUpperCase()}</span>
                    <span>{provider.interval} 秒</span>
                    <span
                      className="truncate font-mono text-xs text-muted-foreground"
                      title={provider.url}
                    >
                      {provider.url}
                    </span>
                    <Badge
                      variant={providerStatusVariant(provider.status)}
                      className="w-fit"
                    >
                      {providerStatusLabel(provider.status)}
                    </Badge>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="查看详情"
                        onClick={() => openProviderDetail(provider)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="修改识别规则"
                        onClick={() => openEditProvider(provider)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="删除识别规则"
                        onClick={() => deleteProvider(provider)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                {localProviders.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    尚无识别规则，可以手工添加或从模板加载。
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="proxy" className="mt-4">
          <div className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
              <span className="text-sm font-medium">
                代理规则（{localRules.length} 条，可拖拽排序）
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={openAddRule}>
                  <Plus className="h-3.5 w-3.5" /> 添加代理规则
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => validateThen(() => saveAndPreview.mutate())}
                  disabled={saveAndPreview.isPending}
                >
                  <Eye className="h-3.5 w-3.5" /> 预览 YAML
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="grid min-w-[980px] grid-cols-[24px_64px_190px_minmax(220px,1fr)_230px_110px_100px] gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span />
                <span>启用</span>
                <span>规则类型</span>
                <span>匹配内容</span>
                <span>处理方式</span>
                <span>域名解析</span>
                <span className="text-right">操作</span>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={(event) => setDragId(Number(event.active.id))}
                onDragEnd={onDragEnd}
                onDragCancel={() => setDragId(null)}
              >
                <SortableContext
                  items={localRules.map((rule) => rule.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {localRules.map((rule) => (
                    <RuleRow
                      key={rule.id}
                      rule={rule}
                      providers={localProviders}
                      targetOptions={targetOptions}
                      onEdit={() => openEditRule(rule)}
                      onDelete={() => void deleteRule(rule)}
                      onViewProvider={openProviderDetail}
                      dragged={dragId === rule.id}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {localRules.length === 0 && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  尚无规则，请从模板加载或手工添加。
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="groups"
          forceMount
          className={cn("mt-4", activeTab !== "groups" && "hidden")}
        >
          <GroupsPanel embedded />
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!providerDraft}
        onOpenChange={(open) => {
          if (!open) setProviderDraft(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {providerDraftIsNew ? "添加识别规则" : "修改识别规则"}
            </DialogTitle>
            <DialogDescription>
              配置供 RULE-SET 代理规则引用的远程规则来源。
            </DialogDescription>
          </DialogHeader>
          {providerDraft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>名称</Label>
                <Input
                  value={providerDraft.name}
                  placeholder="唯一名称，例如 category-ads-all"
                  onChange={(event) =>
                    setProviderDraft({
                      ...providerDraft,
                      name: event.target.value,
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>匹配类型</Label>
                  <Select
                    value={providerDraft.behavior}
                    onChange={(event) =>
                      setProviderDraft({
                        ...providerDraft,
                        behavior: event.target.value,
                      })
                    }
                  >
                    <option value="domain">域名</option>
                    <option value="ipcidr">IP 网段</option>
                    <option value="classical">经典规则</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>格式</Label>
                  <Select
                    value={providerDraft.format}
                    onChange={(event) =>
                      setProviderDraft({
                        ...providerDraft,
                        format: event.target.value,
                      })
                    }
                  >
                    {providerDraft.format !== "mrs" && (
                      <option value={providerDraft.format} disabled>
                        {providerDraft.format.toUpperCase()}（旧格式，需转换）
                      </option>
                    )}
                    <option value="mrs">MRS</option>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>下载地址</Label>
                <Input
                  value={providerDraft.url}
                  placeholder="https://example.com/ruleset.mrs"
                  onChange={(event) =>
                    setProviderDraft({
                      ...providerDraft,
                      url: event.target.value,
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  识别规则仅支持 Mihomo MRS 远程文件；这里必须填写可直接下载的
                  HTTP/HTTPS 地址，不支持粘贴 YAML 或 Text 内容。
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>更新间隔（秒）</Label>
                <Input
                  type="number"
                  min={1}
                  value={providerDraft.interval}
                  onChange={(event) =>
                    setProviderDraft({
                      ...providerDraft,
                      interval: Number(event.target.value) || 86400,
                    })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProviderDraft(null)}>
              取消
            </Button>
            <Button onClick={commitProviderDraft} disabled={saveRules.isPending}>
              {saveRules.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!ruleDraft}
        onOpenChange={(open) => {
          if (!open) setRuleDraft(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {ruleDraftIsNew ? "添加代理规则" : "修改代理规则"}
            </DialogTitle>
            <DialogDescription>
              配置匹配条件、处理方式和 DNS 解析行为。
            </DialogDescription>
          </DialogHeader>
          {ruleDraft && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label>启用规则</Label>
                  <p className="text-xs text-muted-foreground">
                    停用后该规则不会写入最终配置。
                  </p>
                </div>
                <Switch
                  checked={ruleDraft.enabled}
                  onCheckedChange={(enabled) =>
                    setRuleDraft({ ...ruleDraft, enabled })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>规则类型</Label>
                <Select
                  value={ruleDraft.kind}
                  onChange={(event) =>
                    setRuleDraft({
                      ...ruleDraft,
                      kind: event.target.value,
                      value: event.target.value === "MATCH" ? "" : ruleDraft.value,
                    })
                  }
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kindLabel(kind)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>匹配内容</Label>
                {ruleDraft.kind === "MATCH" ? (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    最终兜底规则无需填写匹配内容。
                  </div>
                ) : ruleDraft.kind === "RULE-SET" ? (
                  <Select
                    value={ruleDraft.value}
                    onChange={(event) =>
                      setRuleDraft({ ...ruleDraft, value: event.target.value })
                    }
                  >
                    <option value="">请选择识别规则</option>
                    {localProviders.map((provider) => (
                      <option key={provider.id} value={provider.name}>
                        {provider.name} ·{" "}
                        {BEHAVIOR_LABELS[provider.behavior] ?? provider.behavior} ·{" "}
                        {providerStatusLabel(provider.status)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={ruleDraft.value}
                    placeholder={
                      KIND_PLACEHOLDERS[ruleDraft.kind] ?? "输入匹配内容"
                    }
                    onChange={(event) =>
                      setRuleDraft({ ...ruleDraft, value: event.target.value })
                    }
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>处理方式</Label>
                <Select
                  value={ruleDraftTarget}
                  onChange={(event) =>
                    setRuleDraft({
                      ...ruleDraft,
                      target: event.target.value,
                      base_target: ruleDraftBaseTarget,
                      target_override: event.target.value !== ruleDraftBaseTarget,
                    })
                  }
                >
                  <TargetOptions options={targetOptions} />
                  {!ruleDraftMatchedTarget &&
                    !BUILTIN_TARGETS.includes(ruleDraft.target) && (
                      <option value={ruleDraft.target}>
                        {ruleDraft.target}（目标已失效）
                      </option>
                    )}
                </Select>
                {ruleDraft.target_override && (
                  <div className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <span>已覆盖加载时的处理方式</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setRuleDraft({
                          ...ruleDraft,
                          target: ruleDraftBaseTarget,
                          base_target: ruleDraftBaseTarget,
                          target_override: false,
                        })
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> 恢复基础目标
                    </Button>
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={ruleDraft.no_resolve}
                  onChange={(event) =>
                    setRuleDraft({
                      ...ruleDraft,
                      no_resolve: event.target.checked,
                    })
                  }
                />
                跳过 DNS 解析（生成 no-resolve）
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleDraft(null)}>
              取消
            </Button>
            <Button onClick={commitRuleDraft} disabled={saveRules.isPending}>
              {saveRules.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={loadOpen}
        onOpenChange={(open) => {
          if (open) setLoadOpen(true);
          else closeTemplateLoader();
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>从模板加载</DialogTitle>
            <DialogDescription>
              模板只用于提取识别规则和代理规则；确认后覆盖当前规则，不保存模板名称、URL
              或原始内容。
            </DialogDescription>
          </DialogHeader>
          {!templatePreview ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  模板 URL（二选一）
                </label>
                <Input
                  value={templateURL}
                  onChange={(e) => setTemplateURL(e.target.value)}
                  placeholder="https://raw.githubusercontent.com/..."
                />
              </div>
              {!templateURL.trim() && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">或粘贴模板 YAML</label>
                  <Textarea
                    rows={12}
                    value={templateContent}
                    onChange={(e) => setTemplateContent(e.target.value)}
                    placeholder={
                      "rule-providers:\n  private: ...\nrules:\n  - RULE-SET,private,DIRECT\n  - MATCH,PROXY"
                    }
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                已提取 <strong>{templatePreview.rules.length}</strong> 条规则、
                <strong>{templatePreview.providers.length}</strong>{" "}
                个识别规则。确认后将完整覆盖当前内容。
              </div>
              {templatePreview.providers.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-medium">识别规则预览</div>
                  <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                    {templatePreview.providers.map((provider, index) => (
                      <Badge
                        key={`${provider.name}-${index}`}
                        variant={
                          provider.format === "mrs" ? "secondary" : "warning"
                        }
                      >
                        {provider.name} ·{" "}
                        {BEHAVIOR_LABELS[provider.behavior] ??
                          provider.behavior}{" "}
                        · {provider.format.toUpperCase()}
                      </Badge>
                    ))}
                  </div>
                  {templateHasUnsupportedFormats && (
                    <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      模板包含 YAML/Text 识别规则。当前仅支持 MRS，请先更换为
                      MRS 地址后再加载。
                    </div>
                  )}
                </div>
              )}
              {templatePreview.targets.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-medium">
                    模板处理目标映射
                  </div>
                  <div className="max-h-[32vh] space-y-2 overflow-y-auto">
                    {templatePreview.targets.map((target) => (
                      <div
                        key={target}
                        className="grid grid-cols-[220px_24px_1fr] items-center gap-2 text-sm"
                      >
                        <span
                          className="truncate font-mono text-xs"
                          title={target}
                        >
                          {target}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <Select
                          value={normalizedTarget(
                            mapping[target] ?? "PROXY",
                            targetOptions,
                          )}
                          onChange={(e) =>
                            setMapping((current) => ({
                              ...current,
                              [target]: e.target.value,
                            }))
                          }
                        >
                          <TargetOptions options={targetOptions} />
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                此操作会覆盖当前识别规则和代理规则。
              </div>
            </div>
          )}
          <DialogFooter>
            {templatePreview && (
              <Button
                variant="outline"
                onClick={() => setTemplatePreview(null)}
              >
                返回修改来源
              </Button>
            )}
            <Button variant="outline" onClick={closeTemplateLoader}>
              取消
            </Button>
            {!templatePreview ? (
              <Button
                onClick={() => parseTemplate.mutate()}
                disabled={
                  parseTemplate.isPending ||
                  (!templateURL.trim() && !templateContent.trim())
                }
              >
                {parseTemplate.isPending ? "解析中…" : "解析并预览"}
              </Button>
            ) : (
              <Button
                onClick={() => loadTemplate.mutate()}
                disabled={
                  loadTemplate.isPending || templateHasUnsupportedFormats
                }
              >
                {loadTemplate.isPending ? "加载中…" : "确认覆盖当前规则"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!detailProvider}
        onOpenChange={(open) => {
          if (!open) setDetailProvider(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>识别规则详情</DialogTitle>
            <DialogDescription>
              {detailProvider?.format === "mrs"
                ? "MRS 是 Mihomo 二进制规则集，不展开具体条目。"
                : "查看该来源中的实际匹配条目。"}
            </DialogDescription>
          </DialogHeader>
          {detailProvider?.format === "mrs" ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">名称</div>
                <div className="mt-1 font-medium">{detailProvider.name}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">匹配类型</div>
                <div className="mt-1 font-medium">
                  {BEHAVIOR_LABELS[detailProvider.behavior] ??
                    detailProvider.behavior}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">下载状态</div>
                <Badge
                  className="mt-1"
                  variant={providerStatusVariant(detailProvider.status)}
                >
                  {providerStatusLabel(detailProvider.status)}
                </Badge>
              </div>
            </div>
          ) : detailProvider ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">名称：</span>
                  {detailProvider.name}
                </div>
                <div>
                  <span className="text-muted-foreground">匹配类型：</span>
                  {BEHAVIOR_LABELS[detailProvider.behavior] ??
                    detailProvider.behavior}
                </div>
                <div>
                  <span className="text-muted-foreground">下载状态：</span>
                  {providerStatusLabel(detailProvider.status)}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={contentInput}
                    onChange={(e) => setContentInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setContentQuery(contentInput);
                        setContentPage(1);
                      }
                    }}
                    placeholder="搜索域名、IP 或规则内容"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setContentQuery(contentInput);
                    setContentPage(1);
                  }}
                >
                  搜索
                </Button>
              </div>
              <div className="h-[42vh] overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
                {providerContent.isLoading && (
                  <div className="p-4 text-center text-muted-foreground">
                    正在下载并解析识别规则…
                  </div>
                )}
                {providerContent.error && (
                  <div className="p-4 text-center text-destructive">
                    {(providerContent.error as Error).message}
                  </div>
                )}
                {providerContent.data?.items.map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="border-b px-2 py-1.5 last:border-0"
                  >
                    {item}
                  </div>
                ))}
                {providerContent.data &&
                  providerContent.data.items.length === 0 && (
                    <div className="p-4 text-center text-muted-foreground">
                      没有匹配条目
                    </div>
                  )}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>共 {providerContent.data?.total ?? 0} 条</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={contentPage <= 1}
                    onClick={() => setContentPage((page) => page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span>
                    {contentPage} / {pageCount}
                  </span>
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={contentPage >= pageCount}
                    onClick={() => setContentPage((page) => page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>最终配置预览</DialogTitle>
            <DialogDescription>
              {preview.data
                ? `${preview.data.node_count} 节点 · ${preview.data.group_count} 策略组 · ${preview.data.rule_count} 规则`
                : "生成中…"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md">
            <CodeMirror
              value={preview.data?.yaml ?? ""}
              extensions={[yaml()]}
              theme={oneDark}
              height="60vh"
              editable={false}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => validateThen(() => saveAndApply.mutate())}
              disabled={saveAndApply.isPending}
            >
              <Upload className="h-4 w-4" />{" "}
              {saveAndApply.isPending ? "应用中…" : "保存并应用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
