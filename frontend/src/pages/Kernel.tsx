import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Cpu,
  Eye,
  RotateCw,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  UploadCloud,
  FileCode,
  ExternalLink,
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
import { defineMessages, useMessages } from "@/contexts/language";

const LOG_LEVELS = [
  { value: "silent", label: "logSilent" }, { value: "error", label: "logError" },
  { value: "warning", label: "logWarning" }, { value: "info", label: "logInfo" },
  { value: "debug", label: "logDebug" },
] as const;

const messages = defineMessages({
  logSilent: "静默 (silent)", logError: "仅错误 (error)", logWarning: "警告 (warning)", logInfo: "标准信息 (info)", logDebug: "调试诊断 (debug)",
  basicSaved: "基础设置已保存，等待应用", downloadSaved: "内核下载设置已保存并生效", restarted: "内核已成功重启",
  uploaded: "内核文件上传成功并已启动！", uploadFailed: "上传失败", title: "Mihomo 内核与服务调度",
  description: "配置混合端口、局域网共享、日志级别与内核热重载", preview: "预览生成的配置", restart: "重启内核",
  runtime: "内核运行详情", running: "运行中", stopped: "未运行", installed: "已装版本", notInstalled: "未安装",
  pid: "进程 PID", memory: "当前内存占用", unavailable: "不可用", latest: "最新可用内核", checking: "检测中…",
  tunActive: "TUN 已生效", tunInactive: "TUN 未生效（透明代理不可用）", installTitle: "下载或手动上传内核",
  installDescription: "可手动下载 Mihomo 官方内核，或上传本地二进制文件", suitable: "本机适用内核",
  latestStable: "最新稳定版", manualUpload: "或者手动上传内核", officialDownload: "下载本机适用的官方内核",
  uploading: "正在上传…", selectUpload: "选择文件上传", networkTitle: "代理端口与网络参数",
  networkDescription: "配置本地入站端口以及局域网设备接入策略", mixedPort: "混合代理端口 (HTTP / SOCKS5)", defaultPort: "默认端口为 7890",
  logLevel: "日志输出级别", mirror: "内核下载加速镜像源（可选）", mirrorPlaceholder: "例如 https://ghproxy.com/ 或留空使用官方源",
  allowLan: "允许局域网设备连接 (Allow LAN)", allowLanHint: "开启后局域网内其他设备可通过本机地址和混合端口连接代理",
  previewTitle: "实时生成配置", generating: "正在生成配置…",
}, {
  logSilent: "Silent", logError: "Errors Only", logWarning: "Warnings", logInfo: "Standard Info", logDebug: "Debug Diagnostics",
  basicSaved: "Basic settings saved and waiting to be applied", downloadSaved: "Kernel download settings saved and active", restarted: "Kernel restarted successfully",
  uploaded: "Kernel uploaded and started successfully!", uploadFailed: "Upload failed", title: "Mihomo Kernel & Service Control",
  description: "Configure the mixed port, LAN access, log level, and kernel reload", preview: "Preview Generated Configuration", restart: "Restart Kernel",
  runtime: "Kernel Runtime Details", running: "Running", stopped: "Stopped", installed: "Installed Version", notInstalled: "Not Installed",
  pid: "Process PID", memory: "Current Memory Usage", unavailable: "Unavailable", latest: "Latest Kernel", checking: "Checking…",
  tunActive: "TUN Active", tunInactive: "TUN Inactive (transparent proxy unavailable)", installTitle: "Download or Upload Kernel",
  installDescription: "Download the official Mihomo kernel or upload a local binary", suitable: "Recommended kernel",
  latestStable: "latest stable", manualUpload: "Or upload a kernel manually", officialDownload: "Download the Official Kernel for This Machine",
  uploading: "Uploading…", selectUpload: "Select File to Upload", networkTitle: "Proxy Port & Network Settings",
  networkDescription: "Configure the local inbound port and LAN access policy", mixedPort: "Mixed Proxy Port (HTTP / SOCKS5)", defaultPort: "Default port: 7890",
  logLevel: "Log Level", mirror: "Kernel Download Mirror (optional)", mirrorPlaceholder: "For example https://ghproxy.com/, or leave empty for the official source",
  allowLan: "Allow LAN Devices", allowLanHint: "Allow other LAN devices to connect using this machine's address and mixed proxy port",
  previewTitle: "Live Generated Configuration", generating: "Generating configuration…",
});

export default function KernelPage() {
  const text = useMessages(messages);
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
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
      toast.success(requiresApply ? text.basicSaved : text.downloadSaved);
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["config-pending"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const restartCoreMutation = useMutation({
    mutationFn: () => api.post("/api/core/restart"),
    onSuccess: () => toast.success(text.restarted),
    onError: (e: any) => toast.error(e.message),
  });

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await api.upload("/api/core/upload", file);
      toast.success(text.uploaded);
      qc.invalidateQueries({ queryKey: ["core"] });
    } catch (e: any) {
      toast.error(`${text.uploadFailed}: ${e.message}`);
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
  const officialCoreDownloadURL = core.data?.latest_version && core.data.download_asset?.asset_arch
    ? `https://github.com/MetaCubeX/mihomo/releases/download/${core.data.latest_version}/mihomo-linux-${core.data.download_asset.asset_arch}-${core.data.latest_version}.gz`
    : "https://github.com/MetaCubeX/mihomo/releases/latest";

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Cpu className="h-4.5 w-4.5 text-primary" />
            {text.title}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {text.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="h-3.5 w-3.5" />
            {text.preview}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => restartCoreMutation.mutate()}
            disabled={restartCoreMutation.isPending || !isRunning}
          >
            <RotateCw className={cn("h-3.5 w-3.5", restartCoreMutation.isPending && "animate-spin")} />
            {text.restart}
          </Button>
        </div>
      </div>

      {/* 状态与下载安装面板 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="hover:border-primary/40 transition-all">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold">{text.runtime}</CardTitle>
              <Badge variant={isRunning ? "success" : "destructive"}>
                {isRunning ? text.running : text.stopped}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">{text.installed}</div>
                <div className="font-mono font-semibold mt-0.5">
                  {core.data?.installed_version ? formatCoreVersion(core.data.installed_version) : text.notInstalled}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">{text.pid}</div>
                <div className="font-mono font-semibold mt-0.5">
                  {core.data?.pid || "-"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">{text.memory}</div>
                <div className="font-mono font-semibold mt-0.5">
                  {core.data?.memory_bytes ? formatBytes(core.data.memory_bytes) : text.unavailable}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">{text.latest}</div>
                <div className="font-mono font-semibold mt-0.5 text-primary">
                  {core.data?.latest_version || text.checking}
                </div>
              </div>
            </div>

            {core.data?.last_error && (
              <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono">
                {core.data.last_error}
              </div>
            )}

            {core.data?.tun_active === true && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                {text.tunActive}
              </div>
            )}
            {core.data?.tun_active === false && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {text.tunInactive}
                </div>
                {core.data?.tun_error && (
                  <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono break-all">
                    {core.data.tun_error}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 内核更新/下载/上传 */}
        <Card className="hover:border-primary/40 transition-all">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold">{text.installTitle}</CardTitle>
            <CardDescription>
              {text.installDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {core.data?.download_asset && (
              <div className="flex gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 space-y-0.5">
                  <div className="font-semibold">
                    {text.suitable}: Mihomo {core.data.latest_version || text.latestStable} (linux-{core.data.download_asset.asset_arch}, {core.data.download_asset.label})
                  </div>
                </div>
              </div>
            )}
            <div className="pt-2 border-t border-border/50 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="shrink-0">{text.manualUpload}:</span>
                <a
                  href={officialCoreDownloadURL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 truncate font-medium text-primary underline underline-offset-2 hover:opacity-80"
                >
                  {text.officialDownload}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </div>
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
                {uploading ? text.uploading : text.selectUpload}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 端口与网络基础设置 */}
      {form && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold">{text.networkTitle}</CardTitle>
            <CardDescription>
              {text.networkDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{text.mixedPort}</Label>
                <Input
                  type="number"
                  value={form.mixed_port}
                  onChange={(e) => patch({ mixed_port: Number(e.target.value) })}
                  onBlur={() => saveMutation.mutate({ mixed_port: form.mixed_port })}
                />
                <p className="text-[11px] text-muted-foreground">{text.defaultPort}</p>
              </div>

              <div className="space-y-1.5">
                <Label>{text.logLevel}</Label>
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
                      {text[l.label]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{text.mirror}</Label>
              <Input
                placeholder={text.mirrorPlaceholder}
                value={form.core_mirror || ""}
                onChange={(e) => patch({ core_mirror: e.target.value })}
                onBlur={() => saveMutation.mutate({ core_mirror: form.core_mirror })}
              />
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/60">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold">{text.allowLan}</div>
                <div className="text-[11px] text-muted-foreground">
                  {text.allowLanHint}
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
            <DialogTitle>{text.previewTitle}</DialogTitle>
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
                {text.generating}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
