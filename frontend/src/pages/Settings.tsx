import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Settings,
  Save,
  Globe2,
  Database,
  Lock,
  Sparkles,
  Shield,
} from "lucide-react";
import { api, Settings as SettingsType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export default function SettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<SettingsType | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsType>("/api/settings"),
  });

  useEffect(() => {
    if (!form && settingsQuery.data) {
      setForm({ ...settingsQuery.data });
    }
  }, [settingsQuery.data, form]);

  const patch = (p: Partial<SettingsType>) => setForm((f) => (f ? { ...f, ...p } : f));

  const saveMutation = useMutation({
    mutationFn: () => api.put("/api/settings", form),
    onSuccess: () => {
      toast.success("系统设置保存成功");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!form) return <div className="text-xs text-muted-foreground p-8 text-center">加载设置中…</div>;

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Settings className="h-4.5 w-4.5 text-primary" />
            全局系统配置 (System Settings)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            管理 GeoIP/GeoSite 规则库、更新源与安全选项
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "保存中…" : "保存全局设置"}
        </Button>
      </div>

      {/* Geo 数据库设置 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-indigo-500" />
            <div>
              <CardTitle className="text-base font-bold">GeoIP 与 GeoSite 数据库</CardTitle>
              <CardDescription>
                自动获取地理位置与域名分类数据库，保持分流规则最新
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/60">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">自动定时更新 Geo 数据集</div>
              <div className="text-[11px] text-muted-foreground">
                定时拉取最新的 MetaCubeX/meta-rules-dat 数据库
              </div>
            </div>
            <Switch
              checked={form.geo_auto_update}
              onCheckedChange={(v) => patch({ geo_auto_update: v })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Geo 更新周期 (小时)</Label>
            <Input
              type="number"
              value={form.geo_update_interval || 24}
              onChange={(e) => patch({ geo_update_interval: Number(e.target.value) })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 自更新源设置 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base font-bold">面板自更新与仓库地址</CardTitle>
              <CardDescription>
                支持绑定官方仓库或个人 fork 的 release 发布地址
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>GitHub Release 仓库 (owner/repo)</Label>
            <Input
              value={form.update_repo || ""}
              placeholder="例如 ZoroHasaky/EasyProxy"
              onChange={(e) => patch({ update_repo: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/60">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">通过本地代理拉取面板更新</div>
              <div className="text-[11px] text-muted-foreground">
                当直连 GitHub 较慢时建议开启此项
              </div>
            </div>
            <Switch
              checked={form.update_via_proxy}
              onCheckedChange={(v) => patch({ update_via_proxy: v })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
