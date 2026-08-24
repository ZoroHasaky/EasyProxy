import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, ExternalLink, RefreshCw, Rocket, Undo2 } from "lucide-react";
import { api, MetaInfo, Settings } from "@/lib/api";
import { useUpdate } from "@/contexts/update-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const OfficialRepo = "ZoroHasaky/EasyProxy";

export default function AboutPage() {
  const qc = useQueryClient();
  const { checkResult, checking, checkNow, openDialog, task } = useUpdate();
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get<MetaInfo>("/api/meta") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });
  const [repo, setRepo] = useState("");
  const [viaProxy, setViaProxy] = useState<boolean | null>(null);

  useEffect(() => {
    if (viaProxy === null && settings.data) setViaProxy(settings.data.update_via_proxy);
  }, [settings.data, viaProxy]);

  const taskRunning = task?.running ?? false;
  const repoValue = repo || settings.data?.update_repo || OfficialRepo;
  const proxyValue = viaProxy ?? settings.data?.update_via_proxy ?? false;

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
      return checkNow();
    },
    onSuccess: (res) => {
      if (res?.error) toast.error(res.error);
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
          <div>更新机制：自动检查 GitHub Release → 用户下载更新 → 确认后重启切换</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">更新设置</CardTitle>
          <CardDescription>
            登录后自动检查，并每 6 小时复查一次；只显示提示，不会自动下载或重启。检查不调用 GitHub API。
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
            <Button onClick={() => check.mutate()} disabled={check.isPending || checking || taskRunning}>
              <RefreshCw className={check.isPending || checking ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {check.isPending || checking ? "检查中…" : "检查更新"}
            </Button>
          </div>
        </CardContent>
      </Card>

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
                {checkResult.url && (
                  <a
                    href={checkResult.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-transparent px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <ExternalLink className="h-4 w-4" /> 查看发布说明
                  </a>
                )}
                {checkResult.has_update && (
                  <Button variant="destructive" onClick={openDialog}>
                    <Rocket className="h-4 w-4" />
                    {task?.state === "ready" ? "确认重启" : taskRunning ? "查看更新进度" : "下载更新"}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
