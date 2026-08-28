import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Copy, Download, KeyRound, Link2, Loader2, Lock, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, ClashConfigLink, MetaInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdate } from "@/contexts/update-state";
import { defineMessages, useLanguage, useMessages } from "@/contexts/language";

const messages = defineMessages({
  notRecorded: "未记录", passwordChanged: "管理密码已修改", linkRotated: "配置订阅链接已重新生成，旧链接已失效",
  passwordLength: "新密码至少 8 位", mismatch: "两次输入的新密码不一致", copied: "配置链接已复制",
  copyFailed: "复制失败，请手动复制链接", rotateConfirm: "重新生成后，已添加到 Clash Verge 的旧配置链接将立即失效。确定继续吗？",
  loading: "读取中…", version: "版本", commit: "提交", notEmbedded: "未嵌入", buildTime: "构建时间",
  updateRepo: "更新仓库", deployment: "部署方式", goVersion: "Go 版本", architecture: "系统 / 架构", timezone: "服务时区",
  systemInfo: "系统信息", systemDescription: "当前 EasyProxy 服务的构建与运行环境", checking: "检查中…", checkUpdate: "检查更新",
  exportTitle: "配置导出与分享", exportDescription: "导出可被 Clash Verge 使用的节点与分流配置，不包含本机端口、DNS、TUN 和控制器设置。",
  linkHint: "配置链接会实时读取当前已保存的节点、节点组合与规则；请妥善保管。", download: "下载配置", configLink: "配置链接",
  passwordTitle: "修改管理密码", passwordDescription: "新密码至少 8 位；修改后会立即生效。", currentPassword: "当前密码",
  newPassword: "新密码", confirmPassword: "确认新密码", passwordSecurity: "密码仅以加密摘要形式保存", changing: "修改中…", confirmChange: "确认修改",
  linkDescription: "将此链接添加到 Clash Verge 的订阅中。链接包含节点参数，请勿分享给不可信的人。",
  generating: "正在生成配置链接…", readFailed: "读取配置链接失败，请关闭后重试。",
  refreshHint: "节点或规则保存后，Clash Verge 下次刷新订阅即可获得最新配置；重新生成链接会立即使旧链接失效。",
  regenerate: "重新生成链接", copy: "复制链接",
  releaseBuild: "正式发布", developmentBuild: "开发构建", dockerContainer: "Docker 容器", containerEnvironment: "容器环境", localRun: "本地运行",
}, {
  notRecorded: "Not recorded", passwordChanged: "Management password changed", linkRotated: "Configuration subscription link regenerated; the old link is now invalid",
  passwordLength: "The new password must be at least 8 characters", mismatch: "The new passwords do not match", copied: "Configuration link copied",
  copyFailed: "Copy failed. Please copy the link manually", rotateConfirm: "Regenerating the link will immediately invalidate the old Clash Verge subscription link. Continue?",
  loading: "Loading…", version: "Version", commit: "Commit", notEmbedded: "Not embedded", buildTime: "Build Time",
  updateRepo: "Update Repository", deployment: "Deployment", goVersion: "Go Version", architecture: "System / Architecture", timezone: "Service Time Zone",
  systemInfo: "System Information", systemDescription: "Build and runtime environment of the current EasyProxy service", checking: "Checking…", checkUpdate: "Check for Updates",
  exportTitle: "Export & Share Configuration", exportDescription: "Export nodes and routing rules for Clash Verge without local ports, DNS, TUN, or controller settings.",
  linkHint: "The configuration link always uses the latest saved nodes, groups, and rules. Keep it private.", download: "Download Configuration", configLink: "Configuration Link",
  passwordTitle: "Change Management Password", passwordDescription: "The new password must be at least 8 characters and takes effect immediately.", currentPassword: "Current Password",
  newPassword: "New Password", confirmPassword: "Confirm New Password", passwordSecurity: "Only an encrypted password hash is stored", changing: "Changing…", confirmChange: "Change Password",
  linkDescription: "Add this link as a subscription in Clash Verge. It contains node credentials; do not share it with untrusted people.",
  generating: "Generating configuration link…", readFailed: "Unable to load the configuration link. Close this dialog and try again.",
  refreshHint: "After nodes or rules change, refresh the subscription in Clash Verge. Regenerating the link immediately invalidates the old one.",
  regenerate: "Regenerate Link", copy: "Copy Link",
  releaseBuild: "Release", developmentBuild: "Development Build", dockerContainer: "Docker Container", containerEnvironment: "Container Environment", localRun: "Local Run",
});

type SystemValueKey = "releaseBuild" | "developmentBuild" | "dockerContainer" | "containerEnvironment" | "localRun";

const SYSTEM_VALUE_KEYS: Record<string, SystemValueKey> = {
  "正式发布": "releaseBuild",
  "开发构建": "developmentBuild",
  "Docker 容器": "dockerContainer",
  "容器环境": "containerEnvironment",
  "本地运行": "localRun",
};

function localizeSystemValue(value: string | undefined, text: Record<SystemValueKey, string>) {
  const key = SYSTEM_VALUE_KEYS[value ?? ""];
  return key ? text[key] : value ?? "";
}

function formatTime(value: string | undefined, locale: string, missing: string) {
  if (!value) return missing;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? missing : date.toLocaleString(locale, { hour12: false });
}

export default function SettingsPage() {
  const text = useMessages(messages);
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [configLinkOpen, setConfigLinkOpen] = useState(false);
  const { checkForUpdates, isChecking, setDialogOpen } = useUpdate();
  const metaQuery = useQuery({
    queryKey: ["meta"],
    queryFn: () => api.get<MetaInfo>("/api/meta"),
    refetchInterval: 30_000,
  });
  const passwordMutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/password", { old_password: oldPassword, new_password: newPassword }),
    onSuccess: () => {
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success(text.passwordChanged);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const configLinkQuery = useQuery({
    queryKey: ["clash-config-link"],
    queryFn: () => api.get<ClashConfigLink>("/api/clash-config/link"),
    enabled: configLinkOpen,
  });
  const rotateConfigLink = useMutation({
    mutationFn: () => api.post<ClashConfigLink>("/api/clash-config/link/rotate"),
    onSuccess: (link) => {
      queryClient.setQueryData(["clash-config-link"], link);
      toast.success(text.linkRotated);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const submitPassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error(text.passwordLength);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(text.mismatch);
      return;
    }
    passwordMutation.mutate();
  };

  const openUpdateDialog = () => {
    setDialogOpen(true);
    void checkForUpdates();
  };
  const subscriptionURL = configLinkQuery.data ? new URL(configLinkQuery.data.path, window.location.origin).toString() : "";
  const downloadClashConfig = () => {
    window.location.assign("/api/clash-config/download");
  };
  const copyConfigLink = async () => {
    if (!subscriptionURL) return;
    try {
      if (window.isSecureContext && navigator.clipboard) {
        await navigator.clipboard.writeText(subscriptionURL);
      } else {
        const fallback = document.createElement("textarea");
        fallback.value = subscriptionURL;
        fallback.setAttribute("readonly", "");
        fallback.style.cssText = "position:fixed;opacity:0;pointer-events:none";
        document.body.appendChild(fallback);
        fallback.select();
        fallback.setSelectionRange(0, fallback.value.length);
        const copied = document.execCommand("copy");
        fallback.remove();
        if (!copied) throw new Error("clipboard unavailable");
      }
      toast.success(text.copied);
    } catch {
      toast.error(text.copyFailed);
    }
  };
  const confirmRotateConfigLink = () => {
    if (!window.confirm(text.rotateConfirm)) return;
    rotateConfigLink.mutate();
  };

  const meta = metaQuery.data;
  const system = meta?.system;
  const version = meta?.version ? (meta.version.startsWith("v") ? meta.version : `v${meta.version}`) : text.loading;
  const details = [
    { label: text.version, value: version, hint: localizeSystemValue(system?.build_type, text) },
    { label: text.commit, value: system?.commit || text.notEmbedded, mono: true },
    { label: text.buildTime, value: formatTime(system?.build_time, locale, text.notRecorded) },
    { label: text.updateRepo, value: system?.release_repo || "zorohasaky/easyproxy", mono: true },
    { label: text.deployment, value: localizeSystemValue(system?.deployment, text) || text.loading },
    { label: text.goVersion, value: system?.go_version || text.loading, mono: true },
    { label: text.architecture, value: system?.architecture || text.loading, mono: true },
    { label: text.timezone, value: system?.timezone || text.loading, mono: true },
  ];

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-r from-primary/15 via-indigo-500/10 to-purple-500/15 p-6 shadow-sm sm:p-8">
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-xl shadow-primary/30">
              <Server className="h-7 w-7" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight text-foreground">{text.systemInfo}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{text.systemDescription}</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" className="shrink-0 border-primary/25 bg-card/70" onClick={openUpdateDialog} disabled={isChecking}>
            {isChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {isChecking ? text.checking : text.checkUpdate}
          </Button>
        </div>

        <div className="relative z-10 mt-6 grid grid-cols-1 gap-x-10 gap-y-5 border-t border-primary/15 pt-5 sm:grid-cols-2 lg:grid-cols-3">
          {details.map((item) => (
            <div key={item.label} className="min-w-0">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className={`mt-1 truncate text-sm font-semibold text-foreground ${item.mono ? "font-mono" : ""}`} title={item.value}>
                {item.value}
              </div>
              {item.hint && <div className="mt-1 inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{item.hint}</div>}
            </div>
          ))}
        </div>
      </section>

      <Card className="border-border/80">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-sky-500/10 p-2 text-sky-600 dark:text-sky-400"><Link2 className="h-4.5 w-4.5" /></div>
            <div>
              <CardTitle className="text-base font-bold">{text.exportTitle}</CardTitle>
              <CardDescription>{text.exportDescription}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <p className="text-[11px] text-muted-foreground">{text.linkHint}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={downloadClashConfig}>
              <Download className="h-3.5 w-3.5" />{text.download}
            </Button>
            <Button type="button" size="sm" onClick={() => setConfigLinkOpen(true)}>
              <Link2 className="h-3.5 w-3.5" />{text.configLink}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2 text-primary"><KeyRound className="h-4.5 w-4.5" /></div>
            <div>
              <CardTitle className="text-base font-bold">{text.passwordTitle}</CardTitle>
              <CardDescription>{text.passwordDescription}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submitPassword}>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="current-password">{text.currentPassword}</Label>
                <Input id="current-password" type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password">{text.newPassword}</Label>
                <Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">{text.confirmPassword}</Label>
                <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />{text.passwordSecurity}</div>
              <Button type="submit" size="sm" disabled={passwordMutation.isPending || !oldPassword || !newPassword || !confirmPassword}>
                {passwordMutation.isPending ? <Clock className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                {passwordMutation.isPending ? text.changing : text.confirmChange}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={configLinkOpen} onOpenChange={setConfigLinkOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{text.configLink}</DialogTitle>
            <DialogDescription>{text.linkDescription}</DialogDescription>
          </DialogHeader>
          {configLinkQuery.isLoading ? (
            <div className="flex h-28 items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{text.generating}</div>
          ) : configLinkQuery.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{text.readFailed}</div>
          ) : (
            <div className="space-y-3">
              <Input value={subscriptionURL} readOnly onFocus={(event) => event.currentTarget.select()} className="font-mono text-xs" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">{text.refreshHint}</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={confirmRotateConfigLink} disabled={rotateConfigLink.isPending || configLinkQuery.isLoading}>
              {rotateConfigLink.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{text.regenerate}
            </Button>
            <Button type="button" size="sm" onClick={copyConfigLink} disabled={!subscriptionURL}>
              <Copy className="h-3.5 w-3.5" />{text.copy}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
