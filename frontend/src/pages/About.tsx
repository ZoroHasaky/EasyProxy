import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Rocket, Undo2 } from "lucide-react";
import { api, MetaInfo, UpdateCheck, UpdateStatus, Settings } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const OfficialRepo = "ZoroHasaky/EasyProxy";

const stageText: Record<UpdateStatus["state"], string> = {
  idle: "等待更新",
  checking: "正在获取版本与下载信息",
  downloading: "正在下载更新包",
  verifying: "正在校验更新包",
  installing: "正在解压并安装",
  restarting: "安装完成，正在重启面板",
  ready: "新版本已安装，等待重启",
  error: "更新失败",
};

export default function AboutPage() {
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get<MetaInfo>("/api/meta") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });
  const updateStatus = useQuery({
    queryKey: ["updateStatus"],
    queryFn: () => api.get<UpdateStatus>("/api/update/status"),
    refetchInterval: 1_000,
    retry: false,
  });
  const [repo, setRepo] = useState("");
  const [viaProxy, setViaProxy] = useState<boolean | null>(null);
  const [checkResult, setCheckResult] = useState<UpdateCheck | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (viaProxy === null && settings.data) setViaProxy(settings.data.update_via_proxy);
  }, [settings.data, viaProxy]);

  const task = updateStatus.data;
  const taskRunning = task?.running ?? false;
  const repoValue = repo || settings.data?.update_repo || OfficialRepo;
  const proxyValue = viaProxy ?? settings.data?.update_via_proxy ?? false;

  useEffect(() => {
    if (task?.state !== "restarting") return;
    const timer = setTimeout(() => location.reload(), 8_000);
    return () => clearTimeout(timer);
  }, [task?.state]);

  const persistSettings = async () => {
    await api.put("/api/settings", {
      update_repo: repoValue,
      update_via_proxy: proxyValue,
    });
    qc.invalidateQueries({ queryKey: ["settings"] });
  };

  const saveSettings = useMutation({
    mutationFn: persistSettings,
    onSuccess: () => toast.success("更新设置已保存"),
    onError: (e: any) => toast.error(e.message),
  });

  const check = useMutation({
    mutationFn: async () => {
      await persistSettings();
      return api.get<UpdateCheck>("/api/update/check");
    },
    onSuccess: (res) => {
      setCheckResult(res);
      if (res.error) toast.error(res.error);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const applyUpdate = useMutation({
    mutationFn: async () => {
      await persistSettings();
      return api.post("/api/update/apply");
    },
    onSuccess: () => {
      setConfirmOpen(false);
      toast.success("更新任务已启动，可在页面查看实时状态");
      qc.invalidateQueries({ queryKey: ["updateStatus"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">关于与更新</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            easyproxy
            <Badge variant="secondary">v{meta.data?.version ?? "…"}</Badge>
          </CardTitle>
          <CardDescription>节点聚合 · 可视化规则 · mihomo 代理面板</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div>内核版本：{meta.data?.core?.version || "未安装"}</div>
          <div>更新机制：检测 GitHub Release → 后台下载与校验 → 自动重启切换</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">更新设置</CardTitle>
          <CardDescription>
            GitHub 仓库（owner/repo），默认使用 {OfficialRepo}。网络无法直连 GitHub 时可启用代理。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label>仓库</Label>
              <Input value={repoValue} onChange={(e) => setRepo(e.target.value)} placeholder={OfficialRepo} />
            </div>
            <Button variant="outline" title={`恢复官方源 ${OfficialRepo}`} onClick={() => setRepo(OfficialRepo)}>
              <Undo2 className="h-4 w-4" /> 官方源
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-1">
              <Label>经 mihomo 代理检查和下载</Label>
              <p className="text-xs text-muted-foreground">
                使用当前混合代理端口；启用时需要 mihomo 内核正在运行。
              </p>
            </div>
            <Switch checked={proxyValue} onCheckedChange={setViaProxy} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending || taskRunning}>
              保存设置
            </Button>
            <Button onClick={() => check.mutate()} disabled={check.isPending || taskRunning}>
              <RefreshCw className={check.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {check.isPending ? "检查中…" : "检查更新"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {task && task.state !== "idle" && (
        <Card className={task.state === "error" ? "border-destructive/60" : undefined}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {task.running ? (
                <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
              ) : task.state === "error" ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              )}
              {stageText[task.state]}
              <Badge variant="secondary">{task.via_proxy ? "经代理" : "直连"}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {task.state === "downloading" && (
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
            {task.version && <div>目标版本：v{task.version}</div>}
            {task.error && <div className={task.state === "error" ? "text-destructive" : "text-amber-500"}>{task.error}</div>}
            {task.state === "restarting" && (
              <div className="text-muted-foreground">代理会短暂中断，页面将在约 8 秒后自动刷新。</div>
            )}
          </CardContent>
        </Card>
      )}

      {checkResult && (
        <Card className={checkResult.error ? "border-destructive/60" : undefined}>
          <CardHeader>
            <CardTitle className="text-base">检查结果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {checkResult.error ? (
              <div className="flex items-start gap-2 text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{checkResult.error}</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  当前版本 v{checkResult.current}
                  <span className="text-muted-foreground">→</span>
                  最新版本 v{checkResult.latest}
                  {checkResult.has_update ? <Badge>有新版本</Badge> : <Badge variant="success">已是最新</Badge>}
                </div>
                {checkResult.notes && (
                  <div className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                    {checkResult.notes}
                  </div>
                )}
                {checkResult.has_update && (
                  <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={taskRunning}>
                    <Rocket className="h-4 w-4" /> {taskRunning ? "更新进行中" : "一键更新"}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认更新到 v{checkResult?.latest}？</DialogTitle>
            <DialogDescription>
              更新将在后台下载、校验并安装。完成后面板自动重启，代理会短暂中断几秒。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={() => applyUpdate.mutate()} disabled={applyUpdate.isPending || taskRunning}>
              {applyUpdate.isPending ? "启动中…" : "确认更新"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
