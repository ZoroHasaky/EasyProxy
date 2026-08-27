import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  Edit,
  ExternalLink,
  Shield,
  Layers,
  Clock,
  Zap,
} from "lucide-react";
import { api, autoApplyResultMessage, AutoApplyResponse, Subscription } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { subscriptionUsage, timeAgo, cn } from "@/lib/utils";
import { defineMessages, useLanguage, useMessages } from "@/contexts/language";

const messages = defineMessages({
  applyFailed: "{message}，但自动应用失败，已加入待应用清单", applied: "{message}，{result}",
  updated: "订阅已更新", added: "订阅已添加", syncSuccess: "订阅更新成功", deleted: "已删除该订阅及其关联节点",
  syncPartial: "已更新 {count} 个订阅；{errors}", syncApplyFailed: "已完成 {count} 个订阅的更新，但自动应用失败，已加入待应用清单",
  syncComplete: "已完成 {count} 个订阅的更新并生效", title: "订阅源管理",
  description: "支持 Clash YAML、Base64 与节点链接批量识别解析与定时拉取", updateAll: "更新全部", add: "添加订阅",
  disabled: "已禁用", nodeCount: "{count} 节点", interval: "更新周期", minutes: "{count} 分钟", manualOnly: "仅手动",
  viaProxy: "经代理拉取", yes: "是", no: "否", lastSync: "上次同步", usage: "流量使用情况",
  edit: "编辑订阅", remove: "删除订阅", confirmRemove: "确定删除订阅「{name}」及导入的全部节点吗？", syncNow: "立即同步",
  emptyTitle: "暂无任何订阅源", emptyDescription: "点击上方「添加订阅」按钮填入您的订阅 URL，系统将自动解析节点", addFirst: "添加第一个订阅",
  editTitle: "编辑订阅", addTitle: "添加订阅源", dialogDescription: "配置节点订阅地址、自动同步周期与请求参数",
  name: "订阅名称", namePlaceholder: "例如：某某机场 01", url: "订阅地址 (URL)", updateInterval: "自动更新周期 (分钟)",
  intervalPlaceholder: "0 代表仅手动", userAgent: "自定义 User-Agent", userAgentPlaceholder: "默认 ClashMeta/mihomo",
  proxyFetch: "经代理拉取订阅", proxyFetchHint: "当订阅域名被阻断时开启此选项走内置代理", enable: "启用此订阅",
  enableHint: "禁用后不参与定时更新及配置生成", cancel: "取消", saving: "保存中…", save: "保存订阅",
}, {
  applyFailed: "{message}, but automatic apply failed and the change was added to the pending list", applied: "{message}; {result}",
  updated: "Subscription updated", added: "Subscription added", syncSuccess: "Subscription updated successfully", deleted: "Subscription and its imported nodes deleted",
  syncPartial: "Updated {count} subscriptions; {errors}", syncApplyFailed: "Updated {count} subscriptions, but automatic apply failed and the changes were added to the pending list",
  syncComplete: "Updated and applied {count} subscriptions", title: "Subscriptions",
  description: "Parse Clash YAML, Base64, and node links in bulk with scheduled updates", updateAll: "Update All", add: "Add Subscription",
  disabled: "Disabled", nodeCount: "{count} nodes", interval: "Update Interval", minutes: "{count} min", manualOnly: "Manual Only",
  viaProxy: "Fetch via Proxy", yes: "Yes", no: "No", lastSync: "Last Sync", usage: "Data Usage",
  edit: "Edit Subscription", remove: "Delete Subscription", confirmRemove: "Delete subscription “{name}” and all imported nodes?", syncNow: "Sync Now",
  emptyTitle: "No subscriptions", emptyDescription: "Click Add Subscription above and enter a subscription URL. EasyProxy will parse its nodes automatically.", addFirst: "Add First Subscription",
  editTitle: "Edit Subscription", addTitle: "Add Subscription", dialogDescription: "Configure the subscription URL, automatic sync interval, and request settings",
  name: "Subscription Name", namePlaceholder: "For example: Provider 01", url: "Subscription URL", updateInterval: "Automatic Update Interval (minutes)",
  intervalPlaceholder: "0 for manual only", userAgent: "Custom User-Agent", userAgentPlaceholder: "Default: ClashMeta/mihomo",
  proxyFetch: "Fetch Subscription via Proxy", proxyFetchHint: "Use the built-in proxy when the subscription domain is blocked", enable: "Enable Subscription",
  enableHint: "Disabled subscriptions are excluded from scheduled updates and generated configurations", cancel: "Cancel", saving: "Saving…", save: "Save Subscription",
});

type SubscriptionApplyResponse = AutoApplyResponse & {
  subscription?: Subscription;
  added?: number;
  removed?: number;
};

export function SubscriptionsPanel({ embedded = false }: { embedded?: boolean }) {
  const text = useMessages(messages);
  const { language } = useLanguage();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [userAgent, setUserAgent] = useState("");
  const [updateInterval, setUpdateInterval] = useState(1440); // 默认 24h
  const [viaProxy, setViaProxy] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const subs = useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => api.get<Subscription[]>("/api/subscriptions"),
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
    setEditingSub(null);
    setName("");
    setUrl("");
    setUserAgent("");
    setUpdateInterval(1440);
    setViaProxy(false);
    setEnabled(true);
    setModalOpen(true);
  };

  const openEdit = (s: Subscription) => {
    setEditingSub(s);
    setName(s.name);
    setUrl(s.url);
    setUserAgent(s.user_agent);
    setUpdateInterval(s.update_interval);
    setViaProxy(s.via_proxy);
    setEnabled(s.enabled);
    setModalOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        url: url.trim(),
        user_agent: userAgent.trim(),
        update_interval: Number(updateInterval) || 0,
        via_proxy: viaProxy,
        enabled,
      };
      if (editingSub) {
        return api.put<SubscriptionApplyResponse>(`/api/subscriptions/${editingSub.id}`, payload);
      }
      return api.post<SubscriptionApplyResponse>("/api/subscriptions", payload);
    },
    onSuccess: (res) => {
      reportAutoApply(editingSub ? text.updated : text.added, res);
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: (id: number) => api.post<SubscriptionApplyResponse>(`/api/subscriptions/${id}/update`),
    onSuccess: (res) => {
      reportAutoApply(text.syncSuccess, res);
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const failed: string[] = [];
      let autoApplyFailed = 0;
      let updated = 0;
      for (const sub of subs.data ?? []) {
        try {
          const result = await api.post<SubscriptionApplyResponse>(`/api/subscriptions/${sub.id}/update`);
          updated++;
          if (result.apply_error) autoApplyFailed++;
        } catch (e: any) {
          failed.push(`${sub.name}: ${e.message}`);
        }
      }
      if (failed.length) {
        throw new Error(text.syncPartial.replace("{count}", String(updated)).replace("{errors}", failed.join(language === "zh-CN" ? "；" : "; ")));
      }
      return { updated, autoApplyFailed };
    },
    onSuccess: ({ updated, autoApplyFailed }) => {
      if (autoApplyFailed > 0) {
        toast.warning(text.syncApplyFailed.replace("{count}", String(updated)));
      } else {
        toast.success(text.syncComplete.replace("{count}", String(updated)));
      }
      qc.invalidateQueries({ queryKey: ["config-pending"] });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<AutoApplyResponse>(`/api/subscriptions/${id}`),
    onSuccess: (res) => {
      reportAutoApply(text.deleted, res);
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      {/* 头部操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Globe className="h-4.5 w-4.5 text-primary" />
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
            onClick={() => syncAllMutation.mutate()}
            disabled={syncAllMutation.isPending || !subs.data?.length}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncAllMutation.isPending && "animate-spin")} />
            {text.updateAll}
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            {text.add}
          </Button>
        </div>
      </div>

      {/* 订阅卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subs.data?.map((sub) => {
          const usage = subscriptionUsage(sub.user_info);
          return (
            <Card key={sub.id} className={cn("flex flex-col justify-between transition-all hover:border-primary/40", !sub.enabled && "opacity-60")}>
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="truncate max-w-[180px]">{sub.name}</span>
                      {!sub.enabled && <Badge variant="secondary" className="text-[10px]">{text.disabled}</Badge>}
                    </CardTitle>
                  </div>
                  <Badge variant="purple" className="font-mono text-xs">
                    {text.nodeCount.replace("{count}", String(sub.node_count))}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-border/50">
                  <div>
                    <span className="text-muted-foreground">{text.interval}: </span>
                    <span className="font-medium">{sub.update_interval ? text.minutes.replace("{count}", String(sub.update_interval)) : text.manualOnly}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{text.viaProxy}: </span>
                    <span className="font-medium">{sub.via_proxy ? text.yes : text.no}</span>
                  </div>
                  <div className="col-span-2 text-muted-foreground text-[11px] flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {text.lastSync}: {timeAgo(sub.last_update, language)}
                  </div>
                </div>

                {usage && (
                  <div className="space-y-1.5 rounded-lg bg-muted/40 p-2.5 text-[11px]">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>{text.usage}</span>
                      <span className="font-mono text-foreground">
                        {usage.usedGB} / {usage.totalGB} GB
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-border/70">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${usage.percent}%` }} />
                    </div>
                    <div className="text-right font-mono text-muted-foreground">{usage.percent.toFixed(1)}%</div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => openEdit(sub)}
                      title={text.edit}
                    >
                      <Edit className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => {
                        if (confirm(text.confirmRemove.replace("{name}", sub.name))) {
                          deleteMutation.mutate(sub.id);
                        }
                      }}
                      title={text.remove}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-500 hover:text-rose-600" />
                    </Button>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 text-xs font-semibold"
                    onClick={() => syncMutation.mutate(sub.id)}
                    disabled={syncMutation.isPending}
                  >
                    <RefreshCw className={cn("h-3 w-3", syncMutation.isPending && "animate-spin")} />
                    {text.syncNow}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {subs.data?.length === 0 && (
        <div className="text-center py-12 bg-card/40 rounded-2xl border border-dashed border-border/80">
          <Globe className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <h4 className="text-sm font-semibold text-foreground">{text.emptyTitle}</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {text.emptyDescription}
          </p>
          <Button size="sm" onClick={openAdd} className="mt-4">
            <Plus className="h-4 w-4" /> {text.addFirst}
          </Button>
        </div>
      )}

      {/* 订阅编辑/新增 Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSub ? text.editTitle : text.addTitle}</DialogTitle>
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
              <Label>{text.url}</Label>
              <Input
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{text.updateInterval}</Label>
                <Input
                  type="number"
                  placeholder={text.intervalPlaceholder}
                  value={updateInterval}
                  onChange={(e) => setUpdateInterval(Number(e.target.value))}
                />
              </div>

              <div className="space-y-1.5">
                <Label>{text.userAgent}</Label>
                <Input
                  placeholder={text.userAgentPlaceholder}
                  value={userAgent}
                  onChange={(e) => setUserAgent(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold">{text.proxyFetch}</div>
                <div className="text-[11px] text-muted-foreground">
                  {text.proxyFetchHint}
                </div>
              </div>
              <Switch checked={viaProxy} onCheckedChange={setViaProxy} />
            </div>

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
              disabled={saveMutation.isPending || !name.trim() || !url.trim()}
            >
              {saveMutation.isPending ? text.saving : text.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SubscriptionsPage() {
  return <SubscriptionsPanel />;
}
