import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Rocket } from "lucide-react";
import { useUpdate } from "@/contexts/update-state";
import { formatBytes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const stageText: Record<string, string> = {
  idle: "等待更新",
  checking: "正在获取版本与下载信息",
  downloading: "正在下载更新包",
  verifying: "正在校验更新包",
  installing: "正在解压并安装",
  restarting: "正在重启应用",
  ready: "更新已准备完成",
  error: "更新失败",
};

export function UpdateDialog() {
  const {
    checkResult,
    checking,
    task,
    dialogOpen,
    closeDialog,
    checkNow,
    startUpdate,
    restartApplication,
    starting,
    restarting,
  } = useUpdate();
  const state = task?.state ?? "idle";
  const taskRunning = task?.running ?? false;
  const ready = state === "ready";
  const failed = state === "error";
  const targetVersion = task?.version || checkResult?.latest;

  return (
    <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            应用更新
            {targetVersion && <Badge variant="secondary">v{targetVersion}</Badge>}
          </DialogTitle>
          <DialogDescription>
            自动检查仅提示新版本，不会自动下载或重启应用。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {checking && !checkResult ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 正在检查最新版本…
            </div>
          ) : checkResult?.error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{checkResult.error}</span>
            </div>
          ) : checkResult ? (
            <div className="flex flex-wrap items-center gap-2">
              当前版本 v{checkResult.current}
              <span className="text-muted-foreground">→</span>
              最新版本 v{checkResult.latest}
              {checkResult.has_update ? <Badge variant="warning">发现新版本</Badge> : <Badge variant="success">已是最新</Badge>}
            </div>
          ) : null}

          {task && state !== "idle" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center gap-2 font-medium">
                {taskRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
                ) : failed ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                )}
                {stageText[state] ?? state}
                <Badge variant="secondary">{task.via_proxy ? "经代理" : "直连"}</Badge>
              </div>
              {state === "downloading" && (
                <>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${task.percent}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatBytes(task.completed)} / {task.total > 0 ? formatBytes(task.total) : "未知大小"}</span>
                    <span>{task.total > 0 ? `${task.percent}%` : "下载中"}</span>
                  </div>
                </>
              )}
              {ready && !task.error && (
                <p className="text-muted-foreground">
                  更新包已下载、校验并安装。应用不会自动重启，请确认后再切换到新版本。
                </p>
              )}
              {task.error && <p className={failed ? "text-destructive" : "text-amber-500"}>{task.error}</p>}
            </div>
          )}

          {checkResult?.url && (
            <a
              href={checkResult.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              <ExternalLink className="h-4 w-4" /> 查看发布说明
            </a>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeDialog} disabled={state === "restarting"}>
            {ready ? "稍后重启" : "关闭"}
          </Button>
          {(checkResult?.error || (!checkResult && !checking)) && (
            <Button variant="outline" onClick={() => void checkNow()} disabled={checking}>
              <RefreshCw className={checking ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              重新检查
            </Button>
          )}
          {checkResult?.has_update && (state === "idle" || failed) && (
            <Button onClick={startUpdate} disabled={starting || taskRunning}>
              <Rocket className="h-4 w-4" /> {starting ? "启动中…" : failed ? "重新下载" : "下载更新"}
            </Button>
          )}
          {ready && (
            <Button variant="destructive" onClick={restartApplication} disabled={restarting}>
              <RefreshCw className={restarting ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {restarting ? "正在重启…" : "确认并重启"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
