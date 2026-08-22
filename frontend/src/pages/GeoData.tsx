import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Save, RotateCcw } from "lucide-react";
import { api, Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function parseGeox(text: string) {
  const m: Record<string, string> = {};
  text.split("\n").forEach((line) => {
    const i = line.indexOf("=");
    if (i > 0) m[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return m;
}

export default function GeoDataPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(null);

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });

  useEffect(() => {
    if (!form && settings.data) setForm({ ...settings.data });
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: (geox: Record<string, string>) => api.put("/api/settings", { geox_urls: geox }),
    onSuccess: () => {
      toast.success("已保存，到内核页「应用配置」后内核按新地址更新数据");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // 恢复默认：保存空配置（生成配置时空值自动回退默认源），再用服务端返回的生效值刷新编辑框
  const restoreDefaults = async () => {
    if (!confirm("恢复为默认数据源（jsdelivr 镜像）？当前修改将丢失。")) return;
    try {
      await api.put("/api/settings", { geox_urls: {} });
      const fresh = await api.get<Settings>("/api/settings");
      setForm((f) => (f ? { ...f, geox_urls: fresh.geox_urls } : f));
      toast.success("已恢复默认数据源");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (!form) return <div className="text-muted-foreground">加载中…</div>;
  const geoxText = Object.entries(form.geox_urls ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Geo 数据</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={restoreDefaults}>
            <RotateCcw className="h-4 w-4" /> 恢复默认
          </Button>
          <Button onClick={() => save.mutate(parseGeox(geoxText))} disabled={save.isPending}>
            <Save className="h-4 w-4" /> 保存
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">GeoIP / GeoSite 数据源</CardTitle>
          <CardDescription>
            GeoIP/GeoSite 数据库下载地址（默认使用 jsdelivr 镜像，国内可达）。每行格式：键=URL。
            保存后到<Link to="/kernel" className="mx-1 underline underline-offset-2 hover:text-foreground">内核页</Link>
            应用配置，内核会在启动/更新时按此下载。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            className="min-h-[220px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
            value={geoxText}
            onChange={(e) => setForm((f) => (f ? { ...f, geox_urls: parseGeox(e.target.value) } : f))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
