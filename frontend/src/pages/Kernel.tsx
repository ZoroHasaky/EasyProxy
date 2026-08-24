import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Cpu,
  Download,
  Eye,
  RotateCw,
  Save,
  Rocket,
  ShieldAlert,
  CheckCircle2,
  UploadCloud,
  FileCode,
} from "lucide-react";
import { api, Settings, CoreStatus, GenResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const LOG_LEVELS = [
  { value: "silent", label: "静默 (silent)" },
  { value: "error", label: "仅错误 (error)" },
  { value: "warning", label: "警告 (warning)" },
  { value: "info", label: "标准信息 (info)" },
  { value: "debug", label: "调试诊断 (debug)" },
];

export default function KernelPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [coreVer, setCoreVer] = useState("");
  const [uploading, setUploading] = useState(false);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/api/settings"),
  });

  const core = useQuery({
    queryKey: ["core"],
    queryFn: () => api.get<CoreStatus>("/api/core"),
    refetchInterval: 4000,
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

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put("/api/settings", {
        mixed_port: form?.mixed_port,
        allow_lan: form?.allow_lan,
        log_level: form?.log_level,
        core_mirror: form?.core_mirror,
      }),
    onSuccess: () => {
      toast.success("基础设置已保存，请点击「应用配置」生效");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const applyMutation = useMutation({
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
        res.result === "reloaded"
          ? "配置已热重载生效！"
          : res.result === "restarted"
          ? "内核已自动重启生效！"
          : res.result === "started"
          ? "内核已成功启动！"
          : "配置已保存",
      );
      qc.invalidateQueries({ queryKey: ["core"] });
      qc.invalidateQueries({ queryKey: ["meta"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const downloadCoreMutation = useMutation({
    mutationFn: () => api.post("/api/core/download", { version: coreVer || "latest" }),
    onSuccess: () => {
      toast.success("已触发内核下载任务（下载完成后将自动启动）");
      qc.invalidateQueries({ queryKey: ["core"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const restartCoreMutation = useMutation({
    mutationFn: () => api.post("/api/core/restart"),
    onSuccess: () => toast.success("内核已成功重启"),
    onError: (e: any) => toast.error(e.message),
  });

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await api.upload("/api/core/upload", file);
      toast.success("内核文件上传成功并已启动！");
      qc.invalidateQueries({ queryKey: ["core"] });
    } catch (e: any) {
      toast.error(`上传失败: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const isRunning = core.data?.state === "running";

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Cpu className="h-4.5 w-4.5 text-primary" />
            Mihomo 内核与服务调度
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            配置混合端口、局域网共享、日志级别与内核热重载
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="h-3.5 w-3.5" />
            预览生成的配置
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => restartCoreMutation.mutate()}
            disabled={restartCoreMutation.isPending || !isRunning}
          >
            <RotateCw className={cn("h-3.5 w-3.5", restartCoreMutation.isPending && "animate-spin")} />
            重启内核
          </Button>
          <Button
            size="sm"
            onClick={() => applyMutation.mutate()}
            disabled={applyMutation.isPending}
          >
            <Rocket className="h-4 w-4" />
            应用配置并重载
          </Button>
        </div>
      </div>

      {/* 状态与下载安装面板 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="hover:border-primary/40 transition-all">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold">内核运行详情</CardTitle>
              <Badge variant={isRunning ? "success" : "destructive"}>
                {isRunning ? "运行中" : "未运行"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">已装版本</div>
                <div className="font-mono font-semibold mt-0.5">
                  {core.data?.installed_version || "未安装"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">进程 PID</div>
                <div className="font-mono font-semibold mt-0.5">
                  {core.data?.pid || "-"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">异常重启次数</div>
                <div className="font-mono font-semibold mt-0.5">
                  {core.data?.restarts ?? 0}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">最新可用内核</div>
                <div className="font-mono font-semibold mt-0.5 text-primary">
                  {core.data?.latest_version || "检测中…"}
                </div>
              </div>
            </div>

            {core.data?.last_error && (
              <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono">
                {core.data.last_error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 内核更新/下载/上传 */}
        <Card className="hover:border-primary/40 transition-all">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold">下载或手动上传内核</CardTitle>
            <CardDescription>
              支持在线从 GitHub/加速镜像拉取或上传本地二进制文件
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="内核版本 (留空默认 latest)"
                value={coreVer}
                onChange={(e) => setCoreVer(e.target.value)}
                className="h-9 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => downloadCoreMutation.mutate()}
                disabled={downloadCoreMutation.isPending || core.data?.downloading}
              >
                <Download className={cn("h-3.5 w-3.5", downloadCoreMutation.isPending && "animate-spin")} />
                在线下载
              </Button>
            </div>

            <div className="pt-2 border-t border-border/50 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">或者手动上传内核:</span>
              <label className="cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                  disabled={uploading}
                />
                <Button variant="secondary" size="sm" asChild disabled={uploading}>
                  <span>
                    <UploadCloud className="h-3.5 w-3.5" />
                    {uploading ? "正在上传…" : "选择文件上传"}
                  </span>
                </Button>
              </label>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 端口与网络基础设置 */}
      {form && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">代理端口与网络参数</CardTitle>
            <CardDescription>
              配置本地入站端口以及局域网设备接入策略
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>混合代理端口 (HTTP / SOCKS5)</Label>
                <Input
                  type="number"
                  value={form.mixed_port}
                  onChange={(e) => patch({ mixed_port: Number(e.target.value) })}
                />
                <p className="text-[11px] text-muted-foreground">默认端口为 7890</p>
              </div>

              <div className="space-y-1.5">
                <Label>日志输出级别</Label>
                <Select
                  value={form.log_level}
                  onChange={(e) => patch({ log_level: e.target.value })}
                >
                  {LOG_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>内核下载加速镜像源 (可选)</Label>
              <Input
                placeholder="例如 https://ghproxy.com/ 或留空使用官方源"
                value={form.core_mirror || ""}
                onChange={(e) => patch({ core_mirror: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/60">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold">允许局域网设备连接 (Allow LAN)</div>
                <div className="text-[11px] text-muted-foreground">
                  开启后局域网内其他设备可通过 本机IP:{form.mixed_port} 走代理
                </div>
              </div>
              <Switch
                checked={form.allow_lan}
                onCheckedChange={(v) => patch({ allow_lan: v })}
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                <Save className="h-3.5 w-3.5" />
                仅保存参数
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 预览配置 Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Mihomo 实时生成配置 (config.yaml)</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden rounded-xl border border-border/80 my-2">
            {preview.data ? (
              <CodeMirror
                value={preview.data.yaml}
                height="450px"
                extensions={[yaml()]}
                theme={oneDark}
                readOnly
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
                正在生成配置…
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
