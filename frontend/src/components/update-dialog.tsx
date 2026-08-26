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

const UPDATE_STATUS_LABELS = {
  idle: "等待更新",
  checking: "检查更新",
  downloading: "下载更新",
  verifying: "校验更新包",
  installing: "安装更新",
  restarting: "重启服务",
  ready: "更新已就绪",
  error: "更新失败",
} as const;

export function UpdateDialog() {
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
  const current = checkData?.current || "未知";
  const latest = checkData?.latest || "未知";
  const statusLabel = status ? UPDATE_STATUS_LABELS[status.state] : "";

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>系统更新与版本</DialogTitle>
              <DialogDescription>
                检测并升级 EasyProxy 面板至最新稳定版
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/60">
            <div className="space-y-0.5">
              <div className="text-xs text-muted-foreground">当前运行版本</div>
              <div className="font-semibold text-sm">{current}</div>
            </div>
            <div className="space-y-0.5 text-right">
              <div className="text-xs text-muted-foreground">最新可用版本</div>
              <div className="font-semibold text-sm flex items-center gap-1.5 justify-end">
                {latest}
                {hasUpdate && (
                  <Badge variant="success" className="text-[10px] px-1.5 py-0">
                    新版本
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {checkData?.notes && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                版本更新日志
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
                  状态: {statusLabel}
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
              检查更新失败: {checkData?.error || checkError?.message}
            </div>
          )}

          {!hasUpdate && !isChecking && !checkFailed && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              当前已是最新版本，无需更新
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
            {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : "重新检查"}
          </Button>
          {status?.state === "ready" ? (
            <Button size="sm" onClick={() => restartUpdate()} disabled={isRestarting}>
              {isRestarting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在重启…
                </>
              ) : (
                <>
                  <ArrowUpCircle className="h-4 w-4" />
                  重启并完成更新
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
                  正在更新…
                </>
              ) : (
                <>
                  <ArrowUpCircle className="h-4 w-4" />
                  一键更新到 {latest}
                </>
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
