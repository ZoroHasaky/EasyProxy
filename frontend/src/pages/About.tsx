import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Rocket, Undo2 } from "lucide-react";
import { api, MetaInfo, UpdateCheck, Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

// 与后端 DefaultUpdateRepo 保持一致：未配置时后端自动使用该官方源
const OfficialRepo = "ZoroHasaky/EasyProxy";

export default function AboutPage() {
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get<MetaInfo>("/api/meta") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });
  const [repo, setRepo] = useState("");
  const [checkResult, setCheckResult] = useState<UpdateCheck | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const repoValue = repo || settings.data?.update_repo || OfficialRepo;

  const saveRepo = useMutation({
    mutationFn: () => api.put("/api/settings", { update_repo: repoValue }),
    onSuccess: () => {
      toast.success("更新源已保存");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const check = useMutation({
    mutationFn: async () => {
      if (settings.data?.update_repo !== repoValue && repoValue) {
        await api.put("/api/settings", { update_repo: repoValue });
        qc.invalidateQueries({ queryKey: ["settings"] });
      }
      return api.get<UpdateCheck>("/api/update/check");
    },
    onSuccess: (res) => {
      setCheckResult(res);
      if (res.error) toast.error(res.error);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const applyUpdate = useMutation({
    mutationFn: () => api.post("/api/update/apply"),
    onSuccess: () => {
      setConfirmOpen(false);
      toast.success("新版本已下载，面板即将自动重启切换（约 10 秒后刷新页面）");
      setTimeout(() => location.reload(), 12_000);
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
          <div>更新机制：检测 GitHub Release → 下载新版本二进制 → 自动重启切换</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">更新源</CardTitle>
          <CardDescription>
            GitHub 仓库（owner/repo），Release 由此仓库检测。默认内置官方仓库 {OfficialRepo}，可改为自己的 fork。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label>仓库</Label>
            <Input value={repoValue} onChange={(e) => setRepo(e.target.value)} placeholder={OfficialRepo} />
          </div>
          <Button variant="outline" title={`恢复官方源 ${OfficialRepo}`} onClick={() => setRepo(OfficialRepo)}>
            <Undo2 className="h-4 w-4" /> 官方源
          </Button>
          <Button variant="outline" onClick={() => saveRepo.mutate()}>保存</Button>
          <Button onClick={() => check.mutate()} disabled={check.isPending}>
            <RefreshCw className={check.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            检查更新
          </Button>
        </CardContent>
      </Card>

      {checkResult && !checkResult.error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">检查结果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              当前版本 v{checkResult.current}
              <span className="text-muted-foreground">→</span>
              最新版本 v{checkResult.latest}
              {checkResult.has_update ? (
                <Badge>有新版本</Badge>
              ) : (
                <Badge variant="success">已是最新</Badge>
              )}
            </div>
            {checkResult.notes && (
              <div className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                {checkResult.notes}
              </div>
            )}
            {checkResult.has_update && (
              <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={applyUpdate.isPending}>
                <Rocket className="h-4 w-4" /> {applyUpdate.isPending ? "更新中…" : "一键更新"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认更新到 v{checkResult?.latest}？</DialogTitle>
            <DialogDescription>
              将下载新版本并自动重启面板（内核也会一并重启，代理会短暂中断几秒）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={() => applyUpdate.mutate()} disabled={applyUpdate.isPending}>
              确认更新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
