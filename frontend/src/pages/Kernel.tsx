import { useEffect, useRef, useState } from "react";
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
import { cn, formatBytes, formatCoreVersion } from "@/lib/utils";

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
  const coreFileInputRef = useRef<HTMLInputElement>(null);

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
    mutationFn: (payload: Partial<Settings>) => api.put("/api/settings", payload),
    onSuccess: (_result, payload) => {
      const requiresApply = ["mixed_port", "allow_lan", "log_level"].some((key) => key in payload);
      toast.success(requiresApply ? "基础设置已保存，等待应用" : "内核下载设置已保存并生效");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["config-pending"] });
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

  const handleCoreFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void handleUpload(file);
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
                  {core.data?.installed_version ? formatCoreVersion(core.data.installed_version) : "未安装"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">进程 PID</div>
                <div className="font-mono font-semibold mt-0.5">
                  {core.data?.pid || "-"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">当前内存占用</div>
                <div className="font-mono font-semibold mt-0.5">
                  {core.data?.memory_bytes ? formatBytes(core.data.memory_bytes) : "不可用"}
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
            {core.data?.download_asset && (
              <div className={cn(
                "flex gap-2.5 rounded-xl border p-2.5 text-xs",
                core.data.download_asset.variant === "compatible"
                  ? "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300"
                  : "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
              )}>
                {core.data.download_asset.variant === "compatible" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                <div className="min-w-0 space-y-0.5">
                  <div className="font-semibold">在线下载将使用：{core.data.download_asset.label}（linux-{core.data.download_asset.asset_arch}）</div>
                  <p className="leading-relaxed opacity-85">{core.data.download_asset.reason}</p>
                </div>
              </div>
            )}
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
              <span className="text-xs text-muted-foreground">或者手动上传内核（建议 linux-{core.data?.download_asset?.asset_arch || "amd64"}）:</span>
              <input
                ref={coreFileInputRef}
                type="file"
                className="hidden"
                accept=".gz,.tgz,.tar.gz,application/gzip,application/octet-stream"
                onChange={handleCoreFileChange}
                disabled={uploading}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={uploading}
                onClick={() => coreFileInputRef.current?.click()}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                {uploading ? "正在上传…" : "选择文件上传"}
              </Button>
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
                  onBlur={() => saveMutation.mutate({ mixed_port: form.mixed_port })}
                />
                <p className="text-[11px] text-muted-foreground">默认端口为 7890</p>
              </div>

              <div className="space-y-1.5">
                <Label>日志输出级别</Label>
                <Select
                  value={form.log_level}
                  onChange={(e) => {
                    const logLevel = e.target.value;
                    patch({ log_level: logLevel });
                    saveMutation.mutate({ log_level: logLevel });
                  }}
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
                onBlur={() => saveMutation.mutate({ core_mirror: form.core_mirror })}
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
                onCheckedChange={(v) => {
                  patch({ allow_lan: v });
                  saveMutation.mutate({ allow_lan: v });
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* 预览配置 Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>实时生成配置</DialogTitle>
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
