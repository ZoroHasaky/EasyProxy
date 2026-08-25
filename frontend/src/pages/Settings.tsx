import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Settings, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, Settings as SettingsType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdate } from "@/contexts/update-state";

export default function SettingsPage() {
  const qc = useQueryClient();
  const { setDialogOpen } = useUpdate();
  const [form, setForm] = useState<SettingsType | null>(null);
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsType>("/api/settings"),
  });

  useEffect(() => {
    if (!form && settingsQuery.data) setForm({ ...settingsQuery.data });
  }, [settingsQuery.data, form]);

  const patch = (payload: Partial<SettingsType>) => setForm((current) => (current ? { ...current, ...payload } : current));
  const saveMutation = useMutation({
    mutationFn: (payload: Partial<SettingsType>) => api.put("/api/settings", payload),
    onSuccess: () => {
      toast.success("面板更新设置已保存并生效");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: any) => toast.error(error.message),
  });

  if (!form) return <div className="p-8 text-center text-xs text-muted-foreground">加载设置中…</div>;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-r from-primary/15 via-indigo-500/10 to-purple-500/15 p-8 shadow-sm">
        <div className="relative z-10 flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white shadow-xl shadow-primary/30">
              <Zap className="h-8 w-8 fill-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-foreground">EasyProxy</h2>
              <p className="mt-1 text-xs text-muted-foreground">现代化节点聚合 · 可视化分流规则 · Mihomo 内核面板</p>
            </div>
          </div>
          <Button variant="gradient" onClick={() => setDialogOpen(true)} className="shrink-0">
            <Sparkles className="h-4 w-4" />
            检查系统更新
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
            <Settings className="h-4.5 w-4.5 text-primary" />
            系统设置
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">管理面板更新源与更新代理选项</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base font-bold">面板自更新与仓库地址</CardTitle>
              <CardDescription>支持绑定官方仓库或个人 fork 的 release 发布地址</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>GitHub Release 仓库（owner/repo）</Label>
            <Input value={form.update_repo || ""} placeholder="例如 ZoroHasaky/EasyProxy" onChange={(event) => patch({ update_repo: event.target.value })} onBlur={() => saveMutation.mutate({ update_repo: form.update_repo })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 p-3.5">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">通过本地代理拉取面板更新</div>
              <div className="text-[11px] text-muted-foreground">当直连 GitHub 较慢时建议开启此项</div>
            </div>
            <Switch checked={form.update_via_proxy} onCheckedChange={(value) => { patch({ update_via_proxy: value }); saveMutation.mutate({ update_via_proxy: value }); }} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
