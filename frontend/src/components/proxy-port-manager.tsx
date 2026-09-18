import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, Route, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, AutoApplyResponse, ProxyPort, ProxyPortRule, ProxyPortsResponse, RecognitionRule, RuleTargetOption } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { defineMessages, useLanguage, useMessages } from "@/contexts/language";

const messages = defineMessages({
  title: "多端口分流",
  description: "为每个混合代理端口配置独立的识别规则和出站目标",
  enabled: "启用多端口分流",
  enabledHint: "开启后，7890 和下方启用的端口都会使用独立规则集；关闭后额外端口配置会保留但不会监听。",
  dockerHint: "Docker bridge 模式还需要在 docker-compose.yml 中手动增加端口映射，例如：",
  hostHint: "network_mode: host 模式无需额外增加 Compose 端口映射。",
  noPorts: "暂无代理端口",
  addPort: "新增端口",
  defaultPort: "默认端口",
  name: "名称",
  port: "端口",
  status: "状态",
  active: "已启用",
  inactive: "已停用",
  defaultTarget: "未命中规则时的默认出口",
  rules: "规则",
  edit: "编辑",
  editRules: "配置规则",
  delete: "删除",
  cancel: "取消",
  save: "保存",
  createTitle: "新增代理端口",
  editTitle: "编辑代理端口",
  rulesTitle: "配置端口分流规则",
  rulesDescription: "复用现有识别规则，但可以为此端口选择不同的出站目标。",
  noRules: "暂无识别规则，请先在“识别规则”页面创建。",
  direct: "直连 (DIRECT)",
  reject: "拒绝 (REJECT)",
  proxy: "主代理 (PROXY)",
  auto: "自动测速 (AUTO)",
  selectTarget: "选择出站目标",
  proxyGroups: "节点组合",
  proxyNodes: "节点",
  selectPort: "请选择端口",
  saved: "代理端口配置已保存",
  created: "代理端口已创建",
  deleted: "代理端口已删除",
  rulesSaved: "端口分流规则已保存",
  applyFailed: "{message}，但自动应用失败，已加入待应用列表",
  applied: "{message}，{result}",
  confirmDelete: "确定删除这个代理端口吗？",
}, {
  title: "Multi-Port Routing",
  description: "Configure independent recognition rules and outbound targets for each mixed proxy port",
  enabled: "Enable multi-port routing",
  enabledHint: "When enabled, 7890 and every enabled port below use independent rule sets. Extra port settings are retained but not listened to when disabled.",
  dockerHint: "Docker bridge mode also requires adding the port mapping in docker-compose.yml, for example:",
  hostHint: "network_mode: host does not require extra Compose port mappings.",
  noPorts: "No proxy ports",
  addPort: "Add Port",
  defaultPort: "Default Port",
  name: "Name",
  port: "Port",
  status: "Status",
  active: "Enabled",
  inactive: "Disabled",
  defaultTarget: "Default outbound when no rule matches",
  rules: "Rules",
  edit: "Edit",
  editRules: "Configure Rules",
  delete: "Delete",
  cancel: "Cancel",
  save: "Save",
  createTitle: "Add Proxy Port",
  editTitle: "Edit Proxy Port",
  rulesTitle: "Configure Port Routing Rules",
  rulesDescription: "Reuse existing recognition rules while selecting a different outbound target for this port.",
  noRules: "No recognition rules. Create them on the Recognition Rules page first.",
  direct: "Direct (DIRECT)",
  reject: "Reject (REJECT)",
  proxy: "Primary Proxy (PROXY)",
  auto: "Auto Test (AUTO)",
  selectTarget: "Select outbound target",
  proxyGroups: "Proxy Groups",
  proxyNodes: "Nodes",
  selectPort: "Select a port",
  saved: "Proxy port configuration saved",
  created: "Proxy port created",
  deleted: "Proxy port deleted",
  rulesSaved: "Port routing rules saved",
  applyFailed: "{message}, but automatic apply failed and was added to the pending list",
  applied: "{message}; {result}",
  confirmDelete: "Delete this proxy port?",
});

const BUILTIN_TARGETS = [
  { value: "DIRECT", label: "direct" },
  { value: "REJECT", label: "reject" },
  { value: "PROXY", label: "proxy" },
  { value: "AUTO", label: "auto" },
] as const;

type PortForm = {
  name: string;
  port: number;
  enabled: boolean;
  default_target: string;
};

type PortMutationResponse = AutoApplyResponse & { item?: ProxyPort; items?: ProxyPortRule[] };

function targetLabel(value: string, options: { value: string; label: string }[], text: typeof messages["zh-CN"] | typeof messages.en) {
  const builtin = BUILTIN_TARGETS.find((target) => target.value === value);
  if (builtin) return text[builtin.label];
  const option = options.find((item) => item.value === value);
  if (option) return option.label;
  return value || text.proxy;
}

function ruleTarget(rule: ProxyPortRule): string {
  if (rule.target) return rule.target;
  if (rule.group_id === -1) return "DIRECT";
  if (rule.group_id === -2) return "REJECT";
  if (rule.group_id === -3) return "PROXY";
  if (rule.group_id && rule.group_id > 0) return `@easyproxy/group/${rule.group_id}`;
  return "PROXY";
}

function legacyGroupID(target: string): number {
  if (target === "DIRECT") return -1;
  if (target === "REJECT") return -2;
  if (target === "PROXY") return -3;
  const match = target.match(/^@easyproxy\/group\/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function defaultForm(): PortForm {
  return { name: "", port: 7891, enabled: true, default_target: "PROXY" };
}

export default function ProxyPortManager({ enabled, onEnabledChange, onDefaultPortChange }: { enabled: boolean; onEnabledChange: (value: boolean) => void; onDefaultPortChange?: (port: number) => void }) {
  const text = useMessages(messages);
  const { language } = useLanguage();
  const qc = useQueryClient();
  const [portDialogOpen, setPortDialogOpen] = useState(false);
  const [editingPort, setEditingPort] = useState<ProxyPort | null>(null);
  const [portForm, setPortForm] = useState<PortForm>(defaultForm);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
  const [rulesPort, setRulesPort] = useState<ProxyPort | null>(null);
  const [ruleDraft, setRuleDraft] = useState<Record<number, ProxyPortRule>>({});

  const portsQuery = useQuery({
    queryKey: ["proxyPorts"],
    queryFn: () => api.get<ProxyPortsResponse>("/api/proxy-ports"),
  });
  const recognitionQuery = useQuery({
    queryKey: ["recognitionRules"],
    queryFn: () => api.get<RecognitionRule[]>("/api/recognition-rules"),
  });
  const targetsQuery = useQuery({
    queryKey: ["ruleTargets"],
    queryFn: () => api.get<RuleTargetOption[]>("/api/rule-targets"),
  });

  const ports = portsQuery.data?.items ?? [];
  const recognitionRules = recognitionQuery.data ?? [];
  const targetRefs = targetsQuery.data ?? [];
  const targetOptions = useMemo(() => [
    ...BUILTIN_TARGETS.map((target) => ({ value: target.value, label: text[target.label] })),
    ...targetRefs.filter((target) => target.available).map((target) => ({ value: target.value, label: target.name })),
  ], [targetRefs, text]);

  const report = (message: string, result?: AutoApplyResponse) => {
    if (result?.apply_error) {
      toast.warning(text.applyFailed.replace("{message}", message));
    } else {
      toast.success(text.applied.replace("{message}", message).replace("{result}", result?.apply_result || text.active));
    }
    qc.invalidateQueries({ queryKey: ["config-pending"] });
  };

  const savePort = useMutation({
    mutationFn: async (payload: PortForm & { id?: number }) => {
      if (payload.id) {
        return api.put<PortMutationResponse>(`/api/proxy-ports/${payload.id}`, payload);
      }
      return api.post<PortMutationResponse>("/api/proxy-ports", payload);
    },
    onSuccess: (result, payload) => {
      qc.invalidateQueries({ queryKey: ["proxyPorts"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      if (result.item?.is_default) onDefaultPortChange?.(result.item.port);
      setPortDialogOpen(false);
      report(payload.id ? text.saved : text.created, result);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const deletePort = useMutation({
    mutationFn: (id: number) => api.del<PortMutationResponse>(`/api/proxy-ports/${id}`),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["proxyPorts"] });
      report(text.deleted, result);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const saveRules = useMutation({
    mutationFn: ({ id, rules }: { id: number; rules: ProxyPortRule[] }) => api.put<PortMutationResponse>(`/api/proxy-ports/${id}/rules`, { rules }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["proxyPorts"] });
      setRulesDialogOpen(false);
      report(text.rulesSaved, result);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const openCreate = () => {
    setEditingPort(null);
    setPortForm(defaultForm());
    setPortDialogOpen(true);
  };

  const openEdit = (port: ProxyPort) => {
    setEditingPort(port);
    setPortForm({ name: port.name, port: port.port, enabled: port.enabled, default_target: port.default_target || "PROXY" });
    setPortDialogOpen(true);
  };

  const openRules = (port: ProxyPort) => {
    const draft: Record<number, ProxyPortRule> = {};
    for (const rule of port.rules ?? []) draft[rule.recognition_id] = { ...rule, target: ruleTarget(rule) };
    setRulesPort(port);
    setRuleDraft(draft);
    setRulesDialogOpen(true);
  };

  const persistPort = () => {
    if (!portForm.name.trim()) {
      toast.error(`${text.name} required`);
      return;
    }
    if (portForm.port < 1 || portForm.port > 65535) {
      toast.error(`${text.port}: 1-65535`);
      return;
    }
    savePort.mutate(editingPort ? { ...portForm, id: editingPort.id } : portForm);
  };

  const persistRules = () => {
    if (!rulesPort) return;
    saveRules.mutate({ id: rulesPort.id, rules: Object.values(ruleDraft) });
  };

  return (
    <>
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-bold"><Route className="h-4 w-4 text-primary" />{text.title}</CardTitle>
              <CardDescription>{text.description}</CardDescription>
            </div>
            <Switch checked={enabled} onCheckedChange={onEnabledChange} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[11px] text-muted-foreground">{text.enabledHint}</p>
          <>
            {enabled && (
              <div className="rounded-xl border border-amber-300/50 bg-amber-50/70 p-3 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/20 dark:text-amber-100">
                <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{text.dockerHint} <code className="rounded bg-black/10 px-1 py-0.5">- "7891:7891"</code> · {text.hostHint}</span></div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold">{text.title}</div>
              <Button type="button" size="sm" onClick={openCreate}><Plus className="h-3.5 w-3.5" />{text.addPort}</Button>
            </div>
            <div className="space-y-2">
              {ports.map((port) => {
                  const ruleCount = (port.rules ?? []).filter((rule) => rule.enabled).length;
                  return (
                    <div key={port.id} className={cn("grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_90px_100px_130px_auto] md:items-center", !port.enabled && "opacity-60")}>
                      <div className="min-w-0"><div className="flex items-center gap-2 text-sm font-semibold"><span className="truncate">{port.name}</span>{port.is_default && <Badge variant="secondary" className="text-[10px]">{text.defaultPort}</Badge>}</div><div className="mt-1 text-[11px] text-muted-foreground">{targetLabel(port.default_target, targetOptions, text)}</div></div>
                      <div><div className="text-[10px] text-muted-foreground">{text.port}</div><div className="font-mono text-sm">{port.port}</div></div>
                      <div><div className="text-[10px] text-muted-foreground">{text.status}</div><div className="text-xs">{port.enabled ? text.active : text.inactive}</div></div>
                      <div><div className="text-[10px] text-muted-foreground">{text.rules}</div><div className="text-xs">{ruleCount}</div></div>
                      <div className="flex justify-end gap-1"><Button type="button" variant="outline" size="sm" onClick={() => openRules(port)}>{text.editRules}</Button><Button type="button" variant="ghost" size="iconSm" title={text.edit} onClick={() => openEdit(port)}><Pencil className="h-3.5 w-3.5" /></Button>{!port.is_default && <Button type="button" variant="ghost" size="iconSm" title={text.delete} onClick={() => { if (confirm(text.confirmDelete)) deletePort.mutate(port.id); }}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button>}</div>
                    </div>
                  );
              })}
              {ports.length === 0 && <div className="rounded-xl border border-dashed p-5 text-center text-xs text-muted-foreground">{text.noPorts}</div>}
            </div>
          </>
        </CardContent>
      </Card>

      <Dialog open={portDialogOpen} onOpenChange={setPortDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingPort ? text.editTitle : text.createTitle}</DialogTitle><DialogDescription>{text.description}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>{text.name}</Label><Input value={portForm.name} onChange={(event) => setPortForm((current) => ({ ...current, name: event.target.value }))} placeholder={text.name} /></div>
            <div className="space-y-1.5"><Label>{text.port}</Label><Input type="number" min={1} max={65535} value={portForm.port} onChange={(event) => setPortForm((current) => ({ ...current, port: Number(event.target.value) }))} /></div>
            <div className="space-y-1.5"><Label>{text.defaultTarget}</Label><Select value={portForm.default_target} onChange={(event) => setPortForm((current) => ({ ...current, default_target: event.target.value }))}><option value="">{text.selectTarget}</option>{targetOptions.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</Select></div>
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 p-3"><div className="text-xs font-semibold">{text.status}</div><Switch checked={portForm.enabled} onCheckedChange={(value) => setPortForm((current) => ({ ...current, enabled: value }))} /></div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setPortDialogOpen(false)}>{text.cancel}</Button><Button type="button" onClick={persistPort} disabled={savePort.isPending}>{text.save}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rulesDialogOpen} onOpenChange={setRulesDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader><DialogTitle>{text.rulesTitle}{rulesPort ? ` · ${rulesPort.name}` : ""}</DialogTitle><DialogDescription>{text.rulesDescription}</DialogDescription></DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto py-2 pr-1">
            {recognitionRules.map((rule) => {
              const current = ruleDraft[rule.id];
              const checked = Boolean(current?.enabled);
              return <div key={rule.id} className={cn("grid gap-3 rounded-xl border border-border/60 p-3 md:grid-cols-[auto_minmax(0,1fr)_minmax(180px,220px)] md:items-center", !checked && "opacity-60")}>
                 <input type="checkbox" className="h-4 w-4 accent-primary" checked={checked} onChange={(event) => setRuleDraft((draft) => ({ ...draft, [rule.id]: { recognition_id: rule.id, group_id: legacyGroupID(current?.target ?? "PROXY"), target: current?.target ?? "PROXY", enabled: event.target.checked } }))} />
                 <div className="min-w-0"><div className="truncate text-xs font-semibold">{rule.name}</div><div className="mt-1 text-[11px] text-muted-foreground">{rule.kind} · priority {rule.priority}</div></div>
                 <Select disabled={!checked} value={current?.target ?? "PROXY"} onChange={(event) => setRuleDraft((draft) => ({ ...draft, [rule.id]: { recognition_id: rule.id, group_id: legacyGroupID(event.target.value), target: event.target.value, enabled: true } }))}><option value="DIRECT">{text.direct}</option><option value="REJECT">{text.reject}</option><option value="PROXY">{text.proxy}</option><option value="AUTO">{text.auto}</option><optgroup label={text.proxyGroups}>{targetRefs.filter((target) => target.available && target.kind !== "node").map((target) => <option key={target.value} value={target.value}>{target.name}</option>)}</optgroup><optgroup label={text.proxyNodes}>{targetRefs.filter((target) => target.available && target.kind === "node").map((target) => <option key={target.value} value={target.value}>{target.name}</option>)}</optgroup></Select>
              </div>;
            })}
            {recognitionRules.length === 0 && <div className="rounded-xl border border-dashed p-5 text-center text-xs text-muted-foreground">{text.noRules}</div>}
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setRulesDialogOpen(false)}>{text.cancel}</Button><Button type="button" onClick={persistRules} disabled={!rulesPort || saveRules.isPending}>{text.save}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
