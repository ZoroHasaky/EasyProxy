import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, RefreshCw, Save, Trash2, Eye, Upload, ArrowUpDown, FileInput, AlertTriangle, RotateCcw } from "lucide-react";
import { api, Rule, RuleProvider, RulesPayload, RuleTemplate, RuleTargetOption, GenResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const KINDS = [
  "DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "DOMAIN-REGEX", "IP-CIDR", "IP-CIDR6",
  "GEOIP", "GEOSITE", "SRC-IP-CIDR", "SRC-PORT", "DST-PORT", "PROCESS-NAME",
  "PROCESS-PATH", "IN-TYPE", "RULE-SET", "MATCH",
];
const BUILTIN_TARGETS = ["PROXY", "AUTO", "DIRECT", "REJECT", "REJECT-DROP", "PASS"];
const BUILTIN_TARGET_LABELS: Record<string, string> = {
  PROXY: "代理",
  AUTO: "自动选择",
  DIRECT: "直连",
  REJECT: "拒绝",
  "REJECT-DROP": "拒绝并丢弃",
  PASS: "继续匹配",
};

function targetLabel(target: string) {
  return BUILTIN_TARGET_LABELS[target] ?? target;
}

function optionLabel(option: RuleTargetOption) {
  const icon = option.icon ? `${option.icon} ` : "";
  if (option.kind === "node") {
    const source = option.source_name ? ` · ${option.source_name}` : "";
    return `${icon}${option.name}${source}`;
  }
  const unavailable = option.available ? "" : "，不可用";
  return `${icon}${option.name}（${option.member_count ?? 0} 节点${unavailable}）`;
}

function findTargetOption(target: string, options: RuleTargetOption[]) {
  return options.find((option) => option.value === target) ?? options.find((option) => option.name === target);
}

function normalizedTarget(target: string, options: RuleTargetOption[]) {
  return findTargetOption(target, options)?.value ?? target;
}

function TargetOptions({ options }: { options: RuleTargetOption[] }) {
  const regionGroups = options.filter((option) => option.kind === "region_group");
  const groups = options.filter((option) => option.kind === "group");
  const nodes = options.filter((option) => option.kind === "node");
  return (
    <>
      <optgroup label="内置动作">
        {BUILTIN_TARGETS.map((target) => <option key={target} value={target}>{targetLabel(target)}</option>)}
      </optgroup>
      {regionGroups.length > 0 && (
        <optgroup label="地区策略组">
          {regionGroups.map((option) => (
            <option key={option.value} value={option.value} disabled={!option.available}>{optionLabel(option)}</option>
          ))}
        </optgroup>
      )}
      {groups.length > 0 && (
        <optgroup label="其他策略组">
          {groups.map((option) => (
            <option key={option.value} value={option.value} disabled={!option.available}>{optionLabel(option)}</option>
          ))}
        </optgroup>
      )}
      {nodes.length > 0 && (
        <optgroup label="指定节点">
          {nodes.map((option) => <option key={option.value} value={option.value}>{optionLabel(option)}</option>)}
        </optgroup>
      )}
    </>
  );
}

function RuleRow({
  rule, targetOptions, onChange, onDelete, dragged,
}: {
  rule: Rule;
  targetOptions: RuleTargetOption[];
  onChange: (r: Rule) => void;
  onDelete: () => void;
  dragged: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rule.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const disabled = rule.kind === "MATCH";
  const selectedTarget = normalizedTarget(rule.target, targetOptions);
  const baseTarget = normalizedTarget(rule.base_target || rule.target, targetOptions);
  const matchedTarget = findTargetOption(rule.target, targetOptions);
  const targetAvailable = BUILTIN_TARGETS.includes(rule.target) || matchedTarget?.available === true;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 border-b px-2 py-1.5 text-sm hover:bg-muted/30",
        dragged && "ring-1 ring-emerald-600",
      )}
    >
      <button className="cursor-grab text-muted-foreground hover:text-foreground" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <Switch
        checked={rule.enabled}
        onCheckedChange={(v) => onChange({ ...rule, enabled: v })}
        className="shrink-0"
      />
      <Select
        className="w-40 shrink-0"
        value={rule.kind}
        onChange={(e) => onChange({ ...rule, kind: e.target.value })}
      >
        {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
      </Select>
      <Input
        className="flex-1"
        value={rule.value}
        disabled={disabled}
        placeholder={disabled ? "—" : "匹配值"}
        onChange={(e) => onChange({ ...rule, value: e.target.value })}
      />
      <Select
        className="w-64 shrink-0"
        value={selectedTarget}
        onChange={(e) => onChange({
          ...rule,
          target: e.target.value,
          base_target: baseTarget,
          target_override: e.target.value !== baseTarget,
        })}
      >
        <TargetOptions options={targetOptions} />
        {!matchedTarget && !BUILTIN_TARGETS.includes(rule.target) && (
          <option value={rule.target}>{rule.target}（目标已失效）</option>
        )}
      </Select>
      {rule.target_override && (
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="outline" className="border-amber-300 text-amber-700">已覆盖</Badge>
          <Button
            size="icon"
            variant="ghost"
            title="恢复模板目标"
            onClick={() => onChange({ ...rule, target: baseTarget, base_target: baseTarget, target_override: false })}
          >
            <RotateCcw className="h-4 w-4 text-amber-600" />
          </Button>
        </div>
      )}
      {!targetAvailable && (
        <span className="flex shrink-0 items-center gap-1 text-xs text-destructive" title="目标已失效，应用配置时将回退主代理">
          <AlertTriangle className="h-4 w-4" /> 目标失效
        </span>
      )}
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="跳过 DNS 解析">
        <input
          type="checkbox"
          checked={rule.no_resolve}
          onChange={(e) => onChange({ ...rule, no_resolve: e.target.checked })}
        />
        no-res
      </label>
      <Button size="icon" variant="ghost" onClick={onDelete}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

export default function RulesPage() {
  const qc = useQueryClient();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplURL, setTplURL] = useState("");
  const [tplContent, setTplContent] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const payload = useQuery({
    queryKey: ["rules"],
    queryFn: () => api.get<RulesPayload>("/api/rules"),
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.get<RuleTemplate[]>("/api/templates"),
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

  if (rules === null && payload.data) {
    setRules(payload.data.rules.map((r) => ({ ...r })));
  }
  if (Object.keys(mapping).length === 0 && payload.data?.active_template?.mapping) {
    setMapping({ ...payload.data.active_template.mapping });
  }

  const targetOptions = ruleTargets.data ?? [];

  const saveRules = useMutation({
    mutationFn: () =>
      api.put("/api/rules", {
        rules: rules ?? [],
        providers: payload.data?.providers ?? [],
      }),
    onSuccess: () => {
      toast.success("规则已保存（记得在内核页应用配置）");
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["preview"] });
      setRules(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createTpl = useMutation({
    mutationFn: () =>
      api.post("/api/templates", {
        name: tplName || "模板",
        url: tplURL || undefined,
        content: !tplURL ? tplContent : undefined,
      }),
    onSuccess: () => {
      toast.success("模板已导入并解析");
      setImportOpen(false);
      setTplName(""); setTplURL(""); setTplContent("");
      setRules(null);
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const refreshTpl = useMutation({
    mutationFn: (id: number) => api.post(`/api/templates/${id}/refresh`),
    onSuccess: () => {
      toast.success("模板已刷新");
      setRules(null);
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveMapping = useMutation({
    mutationFn: () => {
      const active = payload.data?.active_template;
      return api.put(`/api/templates/${active!.id}/mapping`, { mapping });
    },
    onSuccess: () => {
      toast.success("映射已保存，规则已按新映射重建");
      setMapping({});
      setRules(null);
      setMappingOpen(false);
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const activateTpl = useMutation({
    mutationFn: (id: number) => api.post(`/api/templates/${id}/activate`),
    onSuccess: () => {
      toast.success("已切换模板");
      setRules(null);
      setMapping({});
      qc.invalidateQueries();
    },
  });

  const deleteTpl = useMutation({
    mutationFn: (id: number) => api.del(`/api/templates/${id}`),
    onSuccess: () => {
      toast.success("已删除");
      setRules(null); setMapping({});
      qc.invalidateQueries();
    },
  });

  const apply = useMutation({
    mutationFn: () => api.post<{ result: string }>("/api/config/apply"),
    onSuccess: (res) => {
      toast.success(`配置已应用（${res.result === "reloaded" ? "热重载" : res.result === "restarted" ? "已重启内核" : res.result}）`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id || !rules) return;
    const oldIdx = rules.findIndex((r) => r.id === active.id);
    const newIdx = rules.findIndex((r) => r.id === over.id);
    setRules(arrayMove(rules, oldIdx, newIdx));
  };

  const updateRule = (r: Rule) =>
    setRules((rs) => (rs ?? []).map((x) => (x.id === r.id ? r : x)));
  const deleteRule = (id: number) => setRules((rs) => (rs ?? []).filter((x) => x.id !== id));
  const addRule = () => {
    const maxId = Math.max(0, ...(rules ?? []).map((r) => r.id)) + 1000;
    setRules((rs) => [
      ...(rs ?? []),
      { id: maxId, template_id: 0, kind: "DOMAIN-SUFFIX", value: "", target: "PROXY", base_target: "PROXY", target_override: false, no_resolve: false, position: 0, enabled: true },
    ]);
  };

  const activeTpl = templates.data?.find((t) => t.id === payload.data?.active_template?.id) ??
    templates.data?.find((t) => t.active);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">规则编辑</h1>
        <div className="flex flex-wrap gap-2">
          <Select
            className="w-48"
            value={activeTpl?.id ?? 0}
            onChange={(e) => activateTpl.mutate(Number(e.target.value))}
          >
            {(templates.data ?? []).length === 0 && <option value={0}>无模板</option>}
            {(templates.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.active ? "✓ " : ""}{t.name}
              </option>
            ))}
          </Select>
          {activeTpl && (
            <Button variant="outline" onClick={() => refreshTpl.mutate(activeTpl.id)} disabled={!activeTpl.url}>
              <RefreshCw className="h-4 w-4" /> 刷新模板
            </Button>
          )}
          <Button variant="outline" onClick={() => setMappingOpen(true)} disabled={!payload.data?.active_template}>
            <ArrowUpDown className="h-4 w-4" /> 分组映射
          </Button>
          <Button variant="outline" onClick={() => deleteTpl.mutate(activeTpl!.id)} disabled={!activeTpl}>
            <Trash2 className="h-4 w-4" /> 删除模板
          </Button>
          <Button onClick={() => setImportOpen(true)}>
            <FileInput className="h-4 w-4" /> 导入模板
          </Button>
        </div>
      </div>

      {payload.data?.providers && payload.data.providers.length > 0 && (
        <div className="rounded-lg border bg-card p-3 text-sm">
          <div className="mb-1 font-medium">Rule Providers（{payload.data.providers.length}）</div>
          <div className="flex flex-wrap gap-1.5">
            {payload.data.providers.map((p: RuleProvider) => (
              <Badge key={p.id} variant="secondary" title={p.url}>
                {p.name} · {p.behavior}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">
            规则列表（{(rules ?? payload.data?.rules ?? []).length} 条，拖拽排序）
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addRule}>
              <Plus className="h-3.5 w-3.5" /> 添加
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="h-3.5 w-3.5" /> 预览 YAML
            </Button>
            <Button size="sm" onClick={() => saveRules.mutate()} disabled={rules === null || saveRules.isPending}>
              <Save className="h-3.5 w-3.5" /> 保存
            </Button>
          </div>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(e) => setDragId(Number(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
          <SortableContext items={(rules ?? []).map((r) => r.id)} strategy={verticalListSortingStrategy}>
            {(rules ?? []).map((r) => (
              <RuleRow
                key={r.id}
                rule={r}
                targetOptions={targetOptions}
                onChange={updateRule}
                onDelete={() => deleteRule(r.id)}
                dragged={dragId === r.id}
              />
            ))}
          </SortableContext>
        </DndContext>
        {!payload.data?.active_template && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            尚无规则模板，请导入（支持 ACL4SSR 等模板 URL 或直接粘贴 YAML）
          </div>
        )}
      </div>

      {/* 导入模板 */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>导入规则模板</DialogTitle>
            <DialogDescription>
              从 URL 下载（如 ACL4SSR 模板）或直接粘贴模板 YAML；导入时自动识别规则引用的目标并给出映射建议
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">模板名称</label>
                <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="ACL4SSR" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">模板 URL（二选一）</label>
                <Input value={tplURL} onChange={(e) => setTplURL(e.target.value)} placeholder="https://raw.githubusercontent.com/..." />
              </div>
            </div>
            {!tplURL && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">或粘贴模板内容</label>
                <Textarea rows={10} value={tplContent} onChange={(e) => setTplContent(e.target.value)}
                  placeholder={"rules:\n  - DOMAIN-SUFFIX,google.com,节点选择\n  - GEOIP,CN,DIRECT\n  - MATCH,节点选择"} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
            <Button onClick={() => createTpl.mutate()} disabled={createTpl.isPending || (!tplURL && !tplContent.trim())}>
              {createTpl.isPending ? "导入中…" : "导入并解析"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 映射向导 */}
      <Dialog open={mappingOpen} onOpenChange={setMappingOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>模板目标 → 面板策略组 映射</DialogTitle>
            <DialogDescription>
              模板中的规则目标名映射到本面板的策略组或内置动作；保存后规则将按新映射重建
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {Object.keys(mapping).sort().map((target) => (
              <div key={target} className="flex items-center gap-3 text-sm">
                <div className="w-48 shrink-0 truncate font-mono text-xs">{target}</div>
                <span className="text-muted-foreground">→</span>
                <Select
                  className="flex-1"
                  value={normalizedTarget(mapping[target], targetOptions)}
                  onChange={(e) => setMapping((m) => ({ ...m, [target]: e.target.value }))}
                >
                  <TargetOptions options={targetOptions} />
                  {!BUILTIN_TARGETS.includes(mapping[target]) && !findTargetOption(mapping[target], targetOptions) && (
                    <option value={mapping[target]}>{mapping[target]}（目标已失效）</option>
                  )}
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingOpen(false)}>取消</Button>
            <Button onClick={() => saveMapping.mutate()} disabled={saveMapping.isPending}>保存映射</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* YAML 预览 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>最终配置预览</DialogTitle>
            <DialogDescription>
              {preview.data ? `${preview.data.node_count} 节点 · ${preview.data.group_count} 策略组 · ${preview.data.rule_count} 规则` : "生成中…"}
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
              onClick={() => {
                saveRules.mutate();
                apply.mutate();
                setPreviewOpen(false);
              }}
              disabled={apply.isPending}
            >
              <Upload className="h-4 w-4" /> {apply.isPending ? "应用中…" : "保存并应用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
