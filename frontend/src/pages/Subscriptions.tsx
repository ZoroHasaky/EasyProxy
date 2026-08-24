import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { api, Subscription } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

// subscription-userinfo（upload/download/total/expire，字节数/时间戳）转 GB 展示
function formatTraffic(info?: string) {
  if (!info) return "-";
  const m: Record<string, number> = {};
  info.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) m[p.slice(0, i).trim()] = Number(p.slice(i + 1));
  });
  const gb = (b: number) => (b / 1024 ** 3).toFixed(2);
  const used = (m.upload || 0) + (m.download || 0);
  const parts: string[] = [];
  if (m.total) {
    const remain = Math.max(m.total - used, 0);
    parts.push(`已用 ${gb(used)} / ${gb(m.total)} GB（剩 ${gb(remain)} GB）`);
  } else if (used) {
    parts.push(`已用 ${gb(used)} GB`);
  }
  if (m.expire) {
    const d = new Date(m.expire * 1000);
    if (!isNaN(d.getTime())) parts.push(`到期 ${d.toLocaleDateString("zh-CN")}`);
  }
  return parts.join(" · ") || "-";
}

function SubDialog({
  open, onClose, initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Subscription | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [ua, setUa] = useState(initial?.user_agent ?? "");
  const [interval, setInterval_] = useState(String(initial?.update_interval ?? 0));
  const [viaProxy, setViaProxy] = useState(initial?.via_proxy ?? false);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name, url, user_agent: ua, update_interval: Number(interval) || 0,
        via_proxy: viaProxy, enabled: true,
      };
      if (initial) return api.put(`/api/subscriptions/${initial.id}`, body);
      return api.post("/api/subscriptions", body);
    },
    onSuccess: () => {
      toast.success(initial ? "订阅已更新" : "订阅已添加并抓取");
      qc.invalidateQueries({ queryKey: ["subs"] });
      qc.invalidateQueries({ queryKey: ["nodes"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "编辑订阅" : "添加订阅"}</DialogTitle>
          <DialogDescription>支持 Clash YAML / Base64 / 明文链接列表三种格式，自动识别</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="我的机场" />
          </div>
          <div className="space-y-1.5">
            <Label>订阅 URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>User-Agent（可选）</Label>
              <Input value={ua} onChange={(e) => setUa(e.target.value)} placeholder="clash.meta" />
            </div>
            <div className="space-y-1.5">
              <Label>自动更新间隔（分钟，0=手动）</Label>
              <Input type="number" value={interval} onChange={(e) => setInterval_(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={viaProxy} onCheckedChange={setViaProxy} id="via-proxy" />
            <Label htmlFor="via-proxy">优先经 mihomo 代理抓取（任一路径失败自动换路重试）</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name || !url}>
            {save.isPending ? "处理中…" : initial ? "保存" : "添加并抓取"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SubscriptionsPanel({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const subs = useQuery({ queryKey: ["subs"], queryFn: () => api.get<Subscription[]>("/api/subscriptions") });

  const updateNow = useMutation({
    mutationFn: (id: number) => api.post(`/api/subscriptions/${id}/update`),
    onSuccess: (res: any) => {
      toast.success(`更新完成：写入 ${res.added}，替换原有 ${res.removed} 个节点`);
      qc.invalidateQueries({ queryKey: ["subs"] });
      qc.invalidateQueries({ queryKey: ["nodes"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/subscriptions/${id}`),
    onSuccess: () => {
      toast.success("订阅及其节点已删除");
      qc.invalidateQueries({ queryKey: ["subs"] });
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["nodeRegions"] });
      qc.invalidateQueries({ queryKey: ["ruleTargets"] });
      qc.invalidateQueries({ queryKey: ["preview"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          {!embedded && <h1 className="text-xl font-semibold">订阅管理</h1>}
          {embedded && (
            <>
              <div className="text-sm font-medium">订阅管理</div>
              <p className="text-xs text-muted-foreground">
                管理节点订阅来源、更新方式和流量信息。
              </p>
            </>
          )}
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4" /> 添加订阅
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>节点数</TableHead>
            <TableHead>流量信息</TableHead>
            <TableHead>最近更新</TableHead>
            <TableHead>自动更新</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(subs.data ?? []).map((sub) => (
            <TableRow key={sub.id}>
              <TableCell>
                <div className="font-medium">{sub.name}</div>
                <div className="max-w-72 truncate text-xs text-muted-foreground">{sub.url}</div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{sub.node_count}</Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatTraffic(sub.user_info)}</TableCell>
              <TableCell className="text-xs">{timeAgo(sub.last_update)}</TableCell>
              <TableCell className="text-xs">
                {sub.update_interval > 0 ? `每 ${sub.update_interval} 分钟` : "手动"}
                {sub.via_proxy && <span className="ml-1 text-emerald-500">(优先经代理)</span>}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" title="立即更新"
                    onClick={() => updateNow.mutate(sub.id)} disabled={updateNow.isPending}>
                    <RefreshCw className={updateNow.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  </Button>
                  <Button size="icon" variant="ghost" title="编辑"
                    onClick={() => { setEditing(sub); setDialogOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title="删除"
                    onClick={() => { if (confirm(`删除订阅 ${sub.name} 及其节点？`)) remove.mutate(sub.id); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {subs.data?.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                暂无订阅，点击右上角添加
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <SubDialog open={dialogOpen} onClose={() => setDialogOpen(false)} initial={editing} key={editing?.id ?? "new"} />
    </div>
  );
}

export default function SubscriptionsPage() {
  return <SubscriptionsPanel />;
}
