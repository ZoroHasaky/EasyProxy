import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe2, RefreshCw, RotateCcw } from "lucide-react";
import { api, GeoDataStatus, GeoDataStatusResponse, Settings as SettingsType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { defineMessages, useLanguage, useMessages } from "@/contexts/language";

const GEO_SOURCE_FIELDS = [
  { key: "geoip", title: "geoipSource", file: "geoip.dat" },
  { key: "geosite", title: "geositeSource", file: "geosite.dat" },
] as const;

const messages = defineMessages({
  geoipSource: "GeoIP 数据源", geositeSource: "GeoSite 数据源", loaded: "已加载", ready: "文件就绪",
  disabled: "已禁用", error: "文件异常", notDownloaded: "未下载", saved: "Geo 设置已保存，等待应用",
  loadingSettings: "加载 Geo 数据设置中…", title: "Geo 数据", description: "管理 GeoIP 与 GeoSite 数据库、数据源和更新状态",
  settingsTitle: "数据源与更新设置", settingsDescription: "Geo 数据仅在启用 GEOIP 或 GEOSITE 识别规则时供 Mihomo 使用。",
  enable: "启用 Geo 数据", enableHint: "供 GEOIP、GEOSITE 规则使用；关闭后不会写入内核配置",
  autoUpdate: "自动定时更新 Geo 数据", autoUpdateHint: "定时拉取最新的 MetaCubeX/meta-rules-dat 数据库",
  interval: "Geo 更新周期（小时）", candidates: "数据源候选（首条生效）",
  candidatesHint: "每行一个 URL。Mihomo 会使用首条地址；内置 3 条推荐镜像，支持自定义数据源。", restore: "恢复推荐源",
  statusTitle: "当前数据状态", statusDescription: "可解析时显示分类与条目数；无法解析时显示上次拉取时间。状态每 30 秒刷新一次。",
  enableFirst: "请先启用 Geo 数据", startCore: "请先启动内核", updateTitle: "按当前生效配置立即更新 GeoIP 与 GeoSite 数据库",
  updating: "更新中…", manualUpdate: "手动更新", refreshStatus: "刷新状态", reading: "正在读取本地数据库状态…",
  readFailed: "无法读取 Geo 数据状态", categories: "分类", entries: "条目", groupsUnit: "个", entriesUnit: "条",
  lastFetch: "上次拉取", noRecord: "暂无记录", file: "文件",
}, {
  geoipSource: "GeoIP Source", geositeSource: "GeoSite Source", loaded: "Loaded", ready: "File Ready",
  disabled: "Disabled", error: "File Error", notDownloaded: "Not Downloaded", saved: "Geo settings saved and waiting to be applied",
  loadingSettings: "Loading Geo data settings…", title: "Geo Data", description: "Manage GeoIP and GeoSite databases, sources, and update status",
  settingsTitle: "Sources & Update Settings", settingsDescription: "Geo data is used by Mihomo only when GEOIP or GEOSITE recognition rules are enabled.",
  enable: "Enable Geo Data", enableHint: "Used by GEOIP and GEOSITE rules; disabled data is omitted from the kernel configuration",
  autoUpdate: "Automatically Update Geo Data", autoUpdateHint: "Periodically download the latest MetaCubeX/meta-rules-dat databases",
  interval: "Geo Update Interval (hours)", candidates: "Source Candidates (first one is active)",
  candidatesHint: "One URL per line. Mihomo uses the first URL; three recommended mirrors are included and custom sources are supported.", restore: "Restore Recommended Sources",
  statusTitle: "Current Data Status", statusDescription: "Shows category and entry counts when parsable, otherwise the last download time. Refreshed every 30 seconds.",
  enableFirst: "Enable Geo Data first", startCore: "Start the kernel first", updateTitle: "Update GeoIP and GeoSite using the active configuration",
  updating: "Updating…", manualUpdate: "Update Now", refreshStatus: "Refresh Status", reading: "Reading local database status…",
  readFailed: "Unable to read Geo data status", categories: "Categories", entries: "Entries", groupsUnit: "groups", entriesUnit: "entries",
  lastFetch: "Last Download", noRecord: "No record", file: "File",
});

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

function statusBadge(status: GeoDataStatus, text: (typeof messages)["zh-CN"] | (typeof messages)["en"]) {
  switch (status.state) {
    case "loaded":
      return <Badge variant="success">{text.loaded}</Badge>;
    case "ready":
      return <Badge variant="info">{text.ready}</Badge>;
    case "disabled":
      return <Badge variant="secondary">{text.disabled}</Badge>;
    case "error":
      return <Badge variant="destructive">{text.error}</Badge>;
    default:
      return <Badge variant="warning">{text.notDownloaded}</Badge>;
  }
}

export default function GeoDataPage() {
  const text = useMessages(messages);
  const { locale } = useLanguage();
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
    if (!form && settingsQuery.data) setForm({ ...settingsQuery.data });
  }, [settingsQuery.data, form]);

  const patch = (p: Partial<SettingsType>) => setForm((current) => (current ? { ...current, ...p } : current));
  const saveMutation = useMutation({
    mutationFn: (payload: Partial<SettingsType>) => {
      const { default_geox_urls: _defaults, ...body } = payload;
      return api.put("/api/settings", body);
    },
    onSuccess: () => {
      toast.success(text.saved);
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["config-pending"] });
      qc.invalidateQueries({ queryKey: ["geo-status"] });
    },
    onError: (error: any) => toast.error(error.message),
  });
  const refreshGeoMutation = useMutation({
    mutationFn: () => api.post<{ message: string }>("/api/geo/refresh"),
    onSuccess: (result) => {
      toast.success(result.message);
      qc.invalidateQueries({ queryKey: ["geo-status"] });
    },
    onError: (error: any) => toast.error(error.message),
  });

  if (!form) return <div className="p-8 text-center text-xs text-muted-foreground">{text.loadingSettings}</div>;

  const canRefreshGeo = form.geo_enabled && geoStatusQuery.data?.core_running !== false;
  const updateGeoSource = (key: "geoip" | "geosite", value: string) => {
    patch({ geox_urls: { ...form.geox_urls, [key]: sourceFieldValue(value) } });
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
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
            <Globe2 className="h-4.5 w-4.5 text-primary" />
            {text.title}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{text.description}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">{text.settingsTitle}</CardTitle>
          <CardDescription>{text.settingsDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 p-3.5">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">{text.enable}</div>
              <div className="text-[11px] text-muted-foreground">{text.enableHint}</div>
            </div>
            <Switch checked={form.geo_enabled} onCheckedChange={(value) => { patch({ geo_enabled: value }); saveMutation.mutate({ geo_enabled: value }); }} />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 p-3.5">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">{text.autoUpdate}</div>
              <div className="text-[11px] text-muted-foreground">{text.autoUpdateHint}</div>
            </div>
            <Switch checked={form.geo_auto_update} onCheckedChange={(value) => { patch({ geo_auto_update: value }); saveMutation.mutate({ geo_auto_update: value }); }} />
          </div>

          <div className="space-y-1.5">
            <Label>{text.interval}</Label>
            <Input type="number" value={form.geo_update_interval || 24} onChange={(event) => patch({ geo_update_interval: Number(event.target.value) })} onBlur={() => saveMutation.mutate({ geo_update_interval: form.geo_update_interval })} />
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 p-3.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-semibold">{text.candidates}</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{text.candidatesHint}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={restoreDefaultGeoSources}><RotateCcw className="h-3.5 w-3.5" />{text.restore}</Button>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {GEO_SOURCE_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label>{text[field.title]}</Label>
                  <Textarea className="min-h-28 font-mono text-xs" value={sourceLines(form.geox_urls[field.key])} placeholder={`https://example.com/${field.file}`} onChange={(event) => updateGeoSource(field.key, event.target.value)} onBlur={(event) => saveGeoSource(field.key, event.currentTarget.value)} />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold">{text.statusTitle}</CardTitle>
              <CardDescription>{text.statusDescription}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => refreshGeoMutation.mutate()} disabled={refreshGeoMutation.isPending || !canRefreshGeo} title={!form.geo_enabled ? text.enableFirst : geoStatusQuery.data?.core_running === false ? text.startCore : text.updateTitle}>
                <RefreshCw className={`h-3.5 w-3.5 ${refreshGeoMutation.isPending ? "animate-spin" : ""}`} />
                {refreshGeoMutation.isPending ? text.updating : text.manualUpdate}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => geoStatusQuery.refetch()} disabled={geoStatusQuery.isFetching}><RefreshCw className={`h-3.5 w-3.5 ${geoStatusQuery.isFetching ? "animate-spin" : ""}`} />{text.refreshStatus}</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {geoStatusQuery.isLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground">{text.reading}</div>
          ) : geoStatusQuery.isError ? (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{text.readFailed}</div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {(geoStatusQuery.data?.items ?? []).map((status) => (
                <div key={status.key} className="rounded-xl border border-border/50 bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold">{status.name}</div>{statusBadge(status, text)}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{status.message}</div>
                  {status.counts_available ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><div className="text-muted-foreground">{text.categories}</div><div className="mt-0.5 font-mono font-semibold">{status.group_count.toLocaleString(locale)} {text.groupsUnit}</div></div>
                      <div><div className="text-muted-foreground">{text.entries}</div><div className="mt-0.5 font-mono font-semibold">{status.entry_count.toLocaleString(locale)} {text.entriesUnit}</div></div>
                    </div>
                  ) : (
                    <div className="mt-3 text-xs">
                      <div className="text-muted-foreground">{text.lastFetch}</div>
                      <div className="mt-0.5 font-mono font-semibold">{status.updated_at ? new Date(status.updated_at).toLocaleString(locale, { hour12: false }) : text.noRecord}</div>
                    </div>
                  )}
                  <div className="mt-3 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                    <div>{text.file}: {status.file} · {formatSize(status.size_bytes)}</div>
                    {status.counts_available && status.updated_at && <div className="mt-0.5">{text.lastFetch}: {new Date(status.updated_at).toLocaleString(locale, { hour12: false })}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
