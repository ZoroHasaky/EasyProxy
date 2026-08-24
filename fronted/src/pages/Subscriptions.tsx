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
import { api, Subscription } from "@/lib/api";
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
import { timeAgo, cn } from "@/lib/utils";

export function SubscriptionsPanel({ embedded = false }: { embedded?: boolean }) {
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
        return api.put(`/api/subscriptions/${editingSub.id}`, payload);
      }
      return api.post("/api/subscriptions", payload);
    },
    onSuccess: () => {
      toast.success(editingSub ? "订阅已更新" : "订阅已添加");
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/subscriptions/${id}/update`),
    onSuccess: () => {
      toast.success("订阅更新成功");
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
      let updated = 0;
      for (const sub of subs.data ?? []) {
        try {
          await api.post(`/api/subscriptions/${sub.id}/update`);
          updated++;
        } catch (e: any) {
          failed.push(`${sub.name}: ${e.message}`);
        }
      }
      if (failed.length) {
        throw new Error(`已更新 ${updated} 个订阅；${failed.join("；")}`);
      }
      return updated;
    },
    onSuccess: (updated) => {
      toast.success(`已完成 ${updated} 个订阅的更新`);
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
    mutationFn: (id: number) => api.del(`/api/subscriptions/${id}`),
    onSuccess: () => {
      toast.success("已删除该订阅及其关联节点");
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
            订阅源管理
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            支持 Clash YAML、Base64 与节点链接批量识别解析与定时拉取
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
            更新全部
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            添加订阅
          </Button>
        </div>
      </div>

      {/* 订阅卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subs.data?.map((sub) => {
          return (
            <Card key={sub.id} className={cn("flex flex-col justify-between transition-all hover:border-primary/40", !sub.enabled && "opacity-60")}>
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="truncate max-w-[180px]">{sub.name}</span>
                      {!sub.enabled && <Badge variant="secondary" className="text-[10px]">已禁用</Badge>}
                    </CardTitle>
                    <CardDescription className="text-xs font-mono truncate max-w-[220px]">
                      {sub.url}
                    </CardDescription>
                  </div>
                  <Badge variant="purple" className="font-mono text-xs">
                    {sub.node_count} 节点
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-border/50">
                  <div>
                    <span className="text-muted-foreground">更新周期: </span>
                    <span className="font-medium">{sub.update_interval ? `${sub.update_interval} 分钟` : "仅手动"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">经代理拉取: </span>
                    <span className="font-medium">{sub.via_proxy ? "是" : "否"}</span>
                  </div>
                  <div className="col-span-2 text-muted-foreground text-[11px] flex items-center gap-1">
                    <Clock className="h-3 w-3" /> 上次同步: {timeAgo(sub.last_update)}
                  </div>
                </div>

                {sub.user_info && (
                  <div className="text-[11px] font-mono p-2 rounded-lg bg-muted/40 text-muted-foreground truncate">
                    {sub.user_info}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => openEdit(sub)}
                      title="编辑订阅"
                    >
                      <Edit className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => {
                        if (confirm(`确定删除订阅「${sub.name}」及导入的全部节点吗？`)) {
                          deleteMutation.mutate(sub.id);
                        }
                      }}
                      title="删除订阅"
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
                    立即同步
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
          <h4 className="text-sm font-semibold text-foreground">暂无任何订阅源</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            点击上方「添加订阅」按钮填入您的订阅 URL，系统将自动解析节点
          </p>
          <Button size="sm" onClick={openAdd} className="mt-4">
            <Plus className="h-4 w-4" /> 添加第一个订阅
          </Button>
        </div>
      )}

      {/* 订阅编辑/新增 Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSub ? "编辑订阅" : "添加订阅源"}</DialogTitle>
            <DialogDescription>
              配置节点订阅地址、自动同步周期与请求参数
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>订阅名称</Label>
              <Input
                placeholder="例如: 某某机场 01"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>订阅地址 (URL)</Label>
              <Input
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>自动更新周期 (分钟)</Label>
                <Input
                  type="number"
                  placeholder="0 代表仅手动"
                  value={updateInterval}
                  onChange={(e) => setUpdateInterval(Number(e.target.value))}
                />
              </div>

              <div className="space-y-1.5">
                <Label>自定义 User-Agent</Label>
                <Input
                  placeholder="默认 ClashMeta/mihomo"
                  value={userAgent}
                  onChange={(e) => setUserAgent(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold">经代理拉取订阅</div>
                <div className="text-[11px] text-muted-foreground">
                  当订阅域名被阻断时开启此选项走内置代理
                </div>
              </div>
              <Switch checked={viaProxy} onCheckedChange={setViaProxy} />
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold">启用此订阅</div>
                <div className="text-[11px] text-muted-foreground">
                  禁用后不参与定时更新及配置生成
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
              disabled={saveMutation.isPending || !name.trim() || !url.trim()}
            >
              {saveMutation.isPending ? "保存中…" : "保存订阅"}
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
