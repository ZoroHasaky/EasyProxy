import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { api, Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const categories = [
  { key: "geoip", label: "GeoIP DAT", description: "GEOIP 规则使用的 IP 数据库" },
  { key: "geosite", label: "GeoSite", description: "GEOSITE 规则使用的域名分类数据库" },
  { key: "geoip.metadb", label: "GeoIP MetaDB", description: "mihomo MetaDB 格式 GeoIP 数据" },
  { key: "mmdb", label: "Country MMDB", description: "国家/地区 MMDB 数据库" },
  { key: "asn", label: "ASN MMDB", description: "自治系统编号数据库" },
] as const;

function cloneSettings(settings: Settings): Settings {
  return {
    ...settings,
    geox_urls: Object.fromEntries(
      Object.entries(settings.geox_urls ?? {}).map(([key, values]) => [key, [...values]]),
    ),
  };
}

export default function GeoDataPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(null);

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });

  useEffect(() => {
    if (!form && settings.data) setForm(cloneSettings(settings.data));
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: () => api.put("/api/settings", {
      geo_enabled: form!.geo_enabled,
      geo_auto_update: form!.geo_auto_update,
      geo_update_interval: form!.geo_update_interval,
      geox_urls: form!.geox_urls,
    }),
    onSuccess: () => {
      toast.success("Geo 配置已保存，到内核页应用配置后生效");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["preview"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const restoreDefaults = async () => {
    if (!confirm("恢复推荐的 Geo 配置和更新地址？当前修改将丢失。")) return;
    try {
      await api.put("/api/settings", {
        geo_enabled: true,
        geo_auto_update: false,
        geo_update_interval: 24,
        geox_urls: {},
      });
      const fresh = await api.get<Settings>("/api/settings");
      setForm(cloneSettings(fresh));
      toast.success("已恢复推荐配置");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["preview"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const updateSource = (key: string, index: number, value: string) => {
    setForm((current) => {
      if (!current) return current;
      const values = [...(current.geox_urls[key] ?? [])];
      values[index] = value;
      return { ...current, geox_urls: { ...current.geox_urls, [key]: values } };
    });
  };

  const addSource = (key: string) => {
    setForm((current) => current ? {
      ...current,
      geox_urls: { ...current.geox_urls, [key]: [...(current.geox_urls[key] ?? []), ""] },
    } : current);
  };

  const removeSource = (key: string, index: number) => {
    setForm((current) => {
      if (!current) return current;
      const values = (current.geox_urls[key] ?? []).filter((_, i) => i !== index);
      return { ...current, geox_urls: { ...current.geox_urls, [key]: values } };
    });
  };

  const moveSource = (key: string, index: number, direction: -1 | 1) => {
    setForm((current) => {
      if (!current) return current;
      const values = [...(current.geox_urls[key] ?? [])];
      const target = index + direction;
      if (target < 0 || target >= values.length) return current;
      [values[index], values[target]] = [values[target], values[index]];
      return { ...current, geox_urls: { ...current.geox_urls, [key]: values } };
    });
  };

  if (!form) return <div className="text-muted-foreground">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Geo</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={restoreDefaults}>
            <RotateCcw className="h-4 w-4" /> 恢复推荐
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4" /> 保存
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">更新设置</CardTitle>
          <CardDescription>
            对应 mihomo 的 geox-url、geo-auto-update 和 geo-update-interval。保存后到
            <Link to="/kernel" className="mx-1 underline underline-offset-2 hover:text-foreground">内核页</Link>
            应用配置。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-3">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-1">
              <Label>启用自定义 Geo 配置</Label>
              <p className="text-xs text-muted-foreground">关闭后不写入自定义 Geo 更新字段</p>
            </div>
            <Switch checked={form.geo_enabled} onCheckedChange={(checked) => setForm({ ...form, geo_enabled: checked })} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-1">
              <Label>自动更新</Label>
              <p className="text-xs text-muted-foreground">由 mihomo 定期更新 Geo 文件</p>
            </div>
            <Switch
              checked={form.geo_auto_update}
              disabled={!form.geo_enabled}
              onCheckedChange={(checked) => setForm({ ...form, geo_auto_update: checked })}
            />
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="geo-interval">更新间隔（小时）</Label>
            <Input
              id="geo-interval"
              type="number"
              min={1}
              max={720}
              disabled={!form.geo_enabled || !form.geo_auto_update}
              value={form.geo_update_interval}
              onChange={(e) => setForm({ ...form, geo_update_interval: Number(e.target.value) || 1 })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {categories.map((category) => {
          const sources = form.geox_urls[category.key] ?? [];
          return (
            <Card key={category.key} className={!form.geo_enabled ? "opacity-60" : undefined}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">{category.label}</CardTitle>
                    <CardDescription>{category.description}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" disabled={!form.geo_enabled} onClick={() => addSource(category.key)}>
                    <Plus className="h-4 w-4" /> 添加地址
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {sources.map((source, index) => (
                  <div key={`${category.key}-${index}`} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-center text-xs text-muted-foreground">{index + 1}</span>
                    <Input
                      className="font-mono text-xs"
                      disabled={!form.geo_enabled}
                      value={source}
                      placeholder="https://..."
                      onChange={(e) => updateSource(category.key, index, e.target.value)}
                    />
                    <Button variant="ghost" size="icon" disabled={!form.geo_enabled || index === 0} title="上移" onClick={() => moveSource(category.key, index, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={!form.geo_enabled || index === sources.length - 1} title="下移" onClick={() => moveSource(category.key, index, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" disabled={!form.geo_enabled} title="删除" onClick={() => removeSource(category.key, index)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
                {sources.length === 0 && (
                  <div className="rounded-md border border-dashed py-5 text-center text-xs text-muted-foreground">
                    未配置地址，此分类不会写入 geox-url
                  </div>
                )}
                <p className="pl-10 text-xs text-muted-foreground">按优先级从上到下排列；mihomo 当前使用首个非空地址。</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
