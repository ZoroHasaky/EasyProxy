import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Settings,
  Globe2,
  Sparkles,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { api, GeoDataStatus, GeoDataStatusResponse, Settings as SettingsType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

const GEO_SOURCE_FIELDS = [
  { key: "geoip", title: "GeoIP 数据源", file: "geoip.dat" },
  { key: "geosite", title: "GeoSite 数据源", file: "geosite.dat" },
] as const;

function sourceLines(urls: string[] | undefined) {
  return (urls ?? []).join("\n");
}

function sourceFieldValue(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatSize(bytes: number) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function statusBadge(status: GeoDataStatus) {
  switch (status.state) {
    case "loaded":
      return <Badge variant="success">已加载</Badge>;
    case "ready":
      return <Badge variant="info">文件就绪</Badge>;
    case "disabled":
      return <Badge variant="secondary">已禁用</Badge>;
    case "error":
      return <Badge variant="destructive">文件异常</Badge>;
    default:
      return <Badge variant="warning">未下载</Badge>;
  }
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<SettingsType | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsType>("/api/settings"),
  });

  const geoStatusQuery = useQuery({
    queryKey: ["geo-status"],
    queryFn: () => api.get<GeoDataStatusResponse>("/api/geo/status"),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!form && settingsQuery.data) {
      setForm({ ...settingsQuery.data });
    }
  }, [settingsQuery.data, form]);

  const patch = (p: Partial<SettingsType>) => setForm((f) => (f ? { ...f, ...p } : f));

  const saveMutation = useMutation({
    mutationFn: (payload: Partial<SettingsType>) => {
      const { default_geox_urls: _defaults, ...body } = payload;
      return api.put("/api/settings", body);
    },
    onSuccess: (_result, payload) => {
      const requiresApply = ["geo_enabled", "geo_auto_update", "geo_update_interval", "geox_urls"].some((key) => key in payload);
      toast.success(requiresApply ? "Geo 设置已保存，等待应用" : "面板更新设置已保存并生效");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["config-pending"] });
      qc.invalidateQueries({ queryKey: ["geo-status"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!form) return <div className="text-xs text-muted-foreground p-8 text-center">加载设置中…</div>;

  const updateGeoSource = (key: "geoip" | "geosite", value: string) => {
    patch({
      geox_urls: {
        ...form.geox_urls,
        [key]: sourceFieldValue(value),
      },
    });
  };

  const saveGeoSource = (key: "geoip" | "geosite", value: string) => {
    const geoxUrls = { ...form.geox_urls, [key]: sourceFieldValue(value) };
    patch({ geox_urls: geoxUrls });
    saveMutation.mutate({ geox_urls: geoxUrls });
  };

  const restoreDefaultGeoSources = () => {
    const geoxUrls = Object.fromEntries(
      Object.entries(form.default_geox_urls ?? {}).map(([key, urls]) => [key, [...urls]]),
    );
    patch({ geox_urls: geoxUrls });
    saveMutation.mutate({ geox_urls: geoxUrls });
  };

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
              <div className="text-xs font-semibold">启用 Geo 数据库</div>
              <div className="text-[11px] text-muted-foreground">
                供 GEOIP、GEOSITE 规则使用；关闭后不会写入内核配置
              </div>
            </div>
            <Switch
              checked={form.geo_enabled}
              onCheckedChange={(v) => {
                patch({ geo_enabled: v });
                saveMutation.mutate({ geo_enabled: v });
              }}
            />
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/60">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">自动定时更新 Geo 数据集</div>
              <div className="text-[11px] text-muted-foreground">
                定时拉取最新的 MetaCubeX/meta-rules-dat 数据库
              </div>
            </div>
            <Switch
              checked={form.geo_auto_update}
              onCheckedChange={(v) => {
                patch({ geo_auto_update: v });
                saveMutation.mutate({ geo_auto_update: v });
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Geo 更新周期 (小时)</Label>
            <Input
              type="number"
              value={form.geo_update_interval || 24}
              onChange={(e) => patch({ geo_update_interval: Number(e.target.value) })}
              onBlur={() => saveMutation.mutate({ geo_update_interval: form.geo_update_interval })}
            />
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 p-3.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-semibold">数据源候选（首条生效）</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  每行一个 URL。Mihomo 会使用首条地址；内置 3 条 MetaCubeX 推荐镜像，支持直接改为自定义数据源。
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={restoreDefaultGeoSources}>
                <RotateCcw className="h-3.5 w-3.5" />
                恢复推荐源
              </Button>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {GEO_SOURCE_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label>{field.title}</Label>
                  <Textarea
                    className="min-h-28 font-mono text-xs"
                    value={sourceLines(form.geox_urls[field.key])}
                    placeholder={`https://example.com/${field.file}`}
                    onChange={(event) => updateGeoSource(field.key, event.target.value)}
                    onBlur={(event) => saveGeoSource(field.key, event.currentTarget.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold">当前数据状态</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  条目数直接从本地 Geo 数据库解析；状态每 30 秒刷新一次。
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => geoStatusQuery.refetch()} disabled={geoStatusQuery.isFetching}>
                <RefreshCw className={`h-3.5 w-3.5 ${geoStatusQuery.isFetching ? "animate-spin" : ""}`} />
                刷新
              </Button>
            </div>
            {geoStatusQuery.isLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">正在读取本地数据库状态…</div>
            ) : geoStatusQuery.isError ? (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">无法读取 Geo 数据状态</div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {(geoStatusQuery.data?.items ?? []).map((status) => (
                  <div key={status.key} className="rounded-xl bg-muted/40 p-3 border border-border/50">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold">{status.name}</div>
                      {statusBadge(status)}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{status.message}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><div className="text-muted-foreground">分类</div><div className="mt-0.5 font-mono font-semibold">{status.group_count.toLocaleString()} 个</div></div>
                      <div><div className="text-muted-foreground">条目</div><div className="mt-0.5 font-mono font-semibold">{status.entry_count.toLocaleString()} 条</div></div>
                    </div>
                    <div className="mt-3 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                      <div>文件：{status.file} · {formatSize(status.size_bytes)}</div>
                      {status.updated_at && <div className="mt-0.5">更新时间：{new Date(status.updated_at).toLocaleString("zh-CN", { hour12: false })}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
              onBlur={() => saveMutation.mutate({ update_repo: form.update_repo })}
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
              onCheckedChange={(v) => {
                patch({ update_via_proxy: v });
                saveMutation.mutate({ update_via_proxy: v });
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
