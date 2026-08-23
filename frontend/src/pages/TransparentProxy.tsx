import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Save } from "lucide-react";
import { api, Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TransparentProxyPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(null);

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });

  useEffect(() => {
    if (!form && settings.data) setForm({ ...settings.data });
  }, [settings.data, form]);

  const patch = (p: Partial<Settings>) => setForm((f) => (f ? { ...f, ...p } : f));

  // 开启 TUN 前预检环境（/dev/net/tun + NET_ADMIN），不满足时提示但不禁用（可先保存待环境就绪）
  const checkTun = async (on: boolean) => {
    patch({ tun_enable: on });
    if (!on) return;
    try {
      const res = await api.get<{ ok: boolean; detail: string }>("/api/tun/check");
      if (!res.ok) {
        toast.error(`TUN 环境不可用：${res.detail}`, { duration: 8000 });
      } else {
        toast.success("TUN 环境检测通过");
      }
    } catch {
      /* 检测失败不阻塞开关 */
    }
  };

  const save = useMutation({
    mutationFn: () =>
      api.put("/api/settings", {
        tun_enable: form?.tun_enable,
        tun_stack: form?.tun_stack,
        dns_enable: form?.dns_enable,
        dns_mode: form?.dns_mode,
        dns_nameserver: form?.dns_nameserver,
        dns_fallback: form?.dns_fallback,
      }),
    onSuccess: () => {
      toast.success("设置已保存，到内核页「应用配置」生效（TUN 变更需重启内核）");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!form) return <div className="text-muted-foreground">加载中…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">透明代理</h1>
        <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="h-4 w-4" /> 保存设置
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">透明代理（TUN 模式）</CardTitle>
          <CardDescription>
            开启后接管本机及经本机转发的流量（auto-route + auto-redirect）。Docker 部署需先在
            docker-compose.yml 中取消注释「透明代理（TUN）模式」配置段（host 网络 + NET_ADMIN + /dev/net/tun）。
            修改后需到<Link to="/kernel" className="mx-1 underline underline-offset-2 hover:text-foreground">内核页</Link>
            应用配置（TUN 变更需重启内核）。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <Switch id="tun" checked={form.tun_enable} onCheckedChange={(v) => checkTun(v)} />
            <Label htmlFor="tun">启用 TUN</Label>
          </div>
          <div className="space-y-1.5">
            <Label>TUN 协议栈</Label>
            <Select value={form.tun_stack} onChange={(e) => patch({ tun_stack: e.target.value })}>
              <option value="mixed">mixed（推荐）</option>
              <option value="system">system</option>
              <option value="gvisor">gvisor</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">DNS</CardTitle>
          <CardDescription>内核内置 DNS，透明代理场景同时承担 LAN 设备的 DNS 解析（劫持 53 端口）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Switch id="dns" checked={form.dns_enable} onCheckedChange={(v) => patch({ dns_enable: v })} />
              <Label htmlFor="dns">启用内置 DNS</Label>
            </div>
            <div className="space-y-1.5">
              <Label>解析模式</Label>
              <Select value={form.dns_mode} onChange={(e) => patch({ dns_mode: e.target.value })}>
                <option value="fake-ip">fake-ip（推荐）</option>
                <option value="redir-host">redir-host</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>主 nameserver（每行一个）</Label>
            <textarea
              className="min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm"
              value={(form.dns_nameserver ?? []).join("\n")}
              onChange={(e) => patch({ dns_nameserver: e.target.value.split("\n").filter(Boolean) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>fallback（每行一个）</Label>
            <textarea
              className="min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm"
              value={(form.dns_fallback ?? []).join("\n")}
              onChange={(e) => patch({ dns_fallback: e.target.value.split("\n").filter(Boolean) })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
