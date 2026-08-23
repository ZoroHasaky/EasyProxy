import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import { Download, Eye, RotateCw, Save, Rocket } from "lucide-react";
import { api, Settings, CoreStatus, GenResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const LOG_LEVELS = ["silent", "error", "warning", "info", "debug"];

export default function KernelPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [coreVer, setCoreVer] = useState("");
  const [uploading, setUploading] = useState(false);

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });
  const core = useQuery({
    queryKey: ["core"],
    queryFn: () => api.get<CoreStatus>("/api/core"),
    refetchInterval: 5_000,
  });
  const preview = useQuery({
    queryKey: ["preview"],
    queryFn: () => api.get<GenResult>("/api/config/preview"),
    enabled: previewOpen,
  });

  useEffect(() => {
    if (!form && settings.data) setForm({ ...settings.data });
  }, [settings.data, form]);

  const patch = (p: Partial<Settings>) => setForm((f) => (f ? { ...f, ...p } : f));

  const save = useMutation({
    mutationFn: () =>
      api.put("/api/settings", {
        mixed_port: form?.mixed_port,
        allow_lan: form?.allow_lan,
        log_level: form?.log_level,
        core_mirror: form?.core_mirror,
      }),
    onSuccess: () => {
      toast.success("设置已保存，点击「应用配置」生效");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const apply = useMutation({
    mutationFn: async () => {
      await api.put("/api/settings", {
        mixed_port: form?.mixed_port,
        allow_lan: form?.allow_lan,
        log_level: form?.log_level,
        core_mirror: form?.core_mirror,
      });
      return api.post<{ result: string }>("/api/config/apply");
    },
    onSuccess: (res) => {
      toast.success(
        res.result === "reloaded" ? "配置已热重载生效" :
        res.result === "restarted" ? "已重启内核生效" :
        res.result === "started" ? "内核已启动" : "已保存（内核未安装，仅保存）",
      );
    },
    onError: (e: any) => toast.error(e.message),
  });

  const downloadCore = useMutation({
    mutationFn: () => api.post("/api/core/download", { version: coreVer || "latest" }),
    onSuccess: () => {
      toast.success("下载任务已开始，状态见下方（完成后自动重启内核）");
      qc.invalidateQueries({ queryKey: ["core"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const restartCore = useMutation({
    mutationFn: () => api.post("/api/core/restart"),
    onSuccess: () => toast.success("内核已重启"),
    onError: (e: any) => toast.error(e.message),
  });
  const uploadCore = async (file: File) => {
    setUploading(true);
    try {
      await api.upload("/api/core/upload", file);
      toast.success("内核已上传并启动");
      qc.invalidateQueries({ queryKey: ["core"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  if (!form) return <div className="text-muted-foreground">加载中…</div>;
  const c = core.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">内核</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPreviewOpen(true)}>
            <Eye className="h-4 w-4" /> 预览 YAML
          </Button>
          <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
            <Rocket className="h-4 w-4" /> {apply.isPending ? "应用中…" : "应用配置"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">内核状态</CardTitle>
          <CardDescription>
            mihomo 内核运行状态，完整日志见<Link to="/logs" className="ml-1 underline underline-offset-2 hover:text-foreground">日志页</Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full",
              c?.state === "running" ? "bg-emerald-500 animate-pulse" : "bg-zinc-500")} />
            {c?.state === "running" ? "运行中" : c?.state ?? "未知"}
            {c?.pid ? <span className="text-xs text-muted-foreground">(PID {c.pid})</span> : null}
          </div>
          <Badge variant={c?.installed ? "success" : "warning"}>
            {c?.installed ? c.installed_version : "未安装"}
          </Badge>
          {c?.latest_version && <span className="text-xs text-muted-foreground">最新版 {c.latest_version}</span>}
          {c?.restarts ? <span className="text-xs text-amber-500">重启 {c.restarts} 次</span> : null}
          {c?.last_error && (
            <span className="text-xs text-destructive" title={c.last_error}>最近错误: {c.last_error.slice(0, 80)}</span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">更新 / 上传</CardTitle>
          <CardDescription>自动依次尝试多个下载源（内置镜像 + 直连），也可在下方指定优先镜像；下载失败时可手动上传</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-44 space-y-1.5">
            <Label>下载版本（留空=最新）</Label>
            <Input value={coreVer} onChange={(e) => setCoreVer(e.target.value)} placeholder={c?.latest_version || "latest"} />
          </div>
          <Button onClick={() => downloadCore.mutate()} disabled={downloadCore.isPending || c?.downloading}>
            <Download className={cn("h-4 w-4", c?.downloading && "animate-bounce")} />
            {c?.downloading ? "下载中…" : "下载内核"}
          </Button>
          <div>
            <Label className="block pb-1.5">手动上传（下载失败时）</Label>
            <input
              type="file"
              className="text-sm"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadCore(f);
                e.target.value = "";
              }}
            />
          </div>
          <Button variant="outline" onClick={() => restartCore.mutate()} disabled={!c?.installed}>
            <RotateCw className="h-4 w-4" /> 重启内核
          </Button>
          {c?.download_error && (
            <div className="w-full text-xs text-destructive">下载失败：{c.download_error}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">内核设置</CardTitle>
          <CardDescription>代理端口等非规则类设置，保存后需「应用配置」生效</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>混合代理端口（HTTP/SOCKS5）</Label>
            <Input type="number" value={form.mixed_port}
              onChange={(e) => patch({ mixed_port: Number(e.target.value) || 7890 })} />
            <p className="text-xs text-muted-foreground">LAN 设备手动代理指向 此端口</p>
          </div>
          <div className="space-y-1.5">
            <Label>日志级别</Label>
            <Select value={form.log_level} onChange={(e) => patch({ log_level: e.target.value })}>
              {LOG_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
            <p className="text-xs text-muted-foreground">内核运行日志级别，见日志页</p>
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Switch id="allow-lan" checked={form.allow_lan} onCheckedChange={(v) => patch({ allow_lan: v })} />
            <Label htmlFor="allow-lan">允许局域网连接（软路由/旁路由必须开启）</Label>
          </div>
          <div className="space-y-1.5">
            <Label>内核下载镜像（优先）</Label>
            <Input value={form.core_mirror ?? ""} onChange={(e) => patch({ core_mirror: e.target.value })}
              placeholder="留空=自动依次尝试内置镜像（直连+ghproxy 等）" />
            <p className="text-xs text-muted-foreground">如 https://ghproxy.net/https://github.com，失败自动换下一个源</p>
          </div>
        </CardContent>
        <CardContent className="pt-0">
          <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4" /> 保存设置
          </Button>
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>最终配置预览</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md">
            <CodeMirror value={preview.data?.yaml ?? ""} extensions={[yaml()]} theme={oneDark} height="60vh" editable={false} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
