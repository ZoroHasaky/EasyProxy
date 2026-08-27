import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useUpdate } from "@/contexts/update-state";
import { ArrowUpCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { defineMessages, useMessages } from "@/contexts/language";

const UPDATE_STATUS_LABELS = {
  idle: "statusIdle", checking: "statusChecking", downloading: "statusDownloading", verifying: "statusVerifying",
  installing: "statusInstalling", restarting: "statusRestarting", ready: "statusReady", error: "statusError",
} as const;

const messages = defineMessages({
  statusIdle: "等待更新", statusChecking: "检查更新", statusDownloading: "下载更新", statusVerifying: "校验更新包",
  statusInstalling: "安装更新", statusRestarting: "重启服务", statusReady: "更新已就绪", statusError: "更新失败",
  unknown: "未知", title: "系统更新与版本", description: "检测并升级 EasyProxy 面板至最新稳定版",
  current: "当前运行版本", latest: "最新可用版本", newVersion: "新版本", notes: "版本更新日志", status: "状态",
  checkFailed: "检查更新失败", upToDate: "当前已是最新版本，无需更新", recheck: "重新检查",
  restarting: "正在重启…", restart: "重启并完成更新", updating: "正在更新…", updateTo: "一键更新到",
}, {
  statusIdle: "Waiting", statusChecking: "Checking", statusDownloading: "Downloading", statusVerifying: "Verifying Package",
  statusInstalling: "Installing", statusRestarting: "Restarting Service", statusReady: "Update Ready", statusError: "Update Failed",
  unknown: "Unknown", title: "System Update & Version", description: "Check for and install the latest stable EasyProxy release",
  current: "Current Version", latest: "Latest Version", newVersion: "New", notes: "Release Notes", status: "Status",
  checkFailed: "Update check failed", upToDate: "EasyProxy is up to date", recheck: "Check Again",
  restarting: "Restarting…", restart: "Restart to Finish", updating: "Updating…", updateTo: "Update to",
});

export function UpdateDialog() {
  const text = useMessages(messages);
  const {
    dialogOpen,
    setDialogOpen,
    checkData,
    checkError,
    status,
    startUpdate,
    restartUpdate,
    isUpdating,
    isRestarting,
    isChecking,
    checkForUpdates,
  } = useUpdate();

  const hasUpdate = checkData?.has_update;
  const checkFailed = Boolean(checkError || checkData?.error);
  const current = checkData?.current || text.unknown;
  const latest = checkData?.latest || text.unknown;
  const statusLabel = status ? text[UPDATE_STATUS_LABELS[status.state]] : "";

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>{text.title}</DialogTitle>
              <DialogDescription>
                {text.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/60">
            <div className="space-y-0.5">
              <div className="text-xs text-muted-foreground">{text.current}</div>
              <div className="font-semibold text-sm">{current}</div>
            </div>
            <div className="space-y-0.5 text-right">
              <div className="text-xs text-muted-foreground">{text.latest}</div>
              <div className="font-semibold text-sm flex items-center gap-1.5 justify-end">
                {latest}
                {hasUpdate && (
                  <Badge variant="success" className="text-[10px] px-1.5 py-0">
                    {text.newVersion}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {checkData?.notes && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {text.notes}
              </div>
              <div className="max-h-40 overflow-y-auto rounded-xl bg-background/50 border border-border/60 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                {checkData.notes}
              </div>
            </div>
          )}

          {status && (isUpdating || status.state === "ready" || status.state === "error") && (
            <div className="space-y-2 rounded-xl bg-primary/5 border border-primary/20 p-3.5">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="flex items-center gap-1.5 text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {text.status}: {statusLabel}
                </span>
                <span>{status.percent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20">
                <div
                  className="h-full bg-primary transition-all duration-300 rounded-full"
                  style={{ width: `${status.percent}%` }}
                />
              </div>
              {status.total > 0 && (
                <div className="text-[11px] text-muted-foreground text-right">
                  {formatBytes(status.completed)} / {formatBytes(status.total)}
                </div>
              )}
            </div>
          )}

          {checkFailed && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
              {text.checkFailed}: {checkData?.error || checkError?.message}
            </div>
          )}

          {!hasUpdate && !isChecking && !checkFailed && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {text.upToDate}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => checkForUpdates()}
            disabled={isChecking || isUpdating}
          >
            {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : text.recheck}
          </Button>
          {status?.state === "ready" ? (
            <Button size="sm" onClick={() => restartUpdate()} disabled={isRestarting}>
              {isRestarting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {text.restarting}
                </>
              ) : (
                <>
                  <ArrowUpCircle className="h-4 w-4" />
                  {text.restart}
                </>
              )}
            </Button>
          ) : hasUpdate ? (
            <Button
              size="sm"
              onClick={() => startUpdate()}
              disabled={isUpdating}
            >
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {text.updating}
                </>
              ) : (
                <>
                  <ArrowUpCircle className="h-4 w-4" />
                  {text.updateTo} {latest}
                </>
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
