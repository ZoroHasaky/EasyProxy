import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Network,
  Save,
  ShieldCheck,
  Zap,
  Info,
  Layers,
  Server,
  AlertTriangle,
} from "lucide-react";
import { api, Settings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function TransparentProxyPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(null);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/api/settings"),
  });

  useEffect(() => {
    if (!form && settings.data) setForm({ ...settings.data });
  }, [settings.data, form]);

  const patch = (p: Partial<Settings>) => setForm((f) => (f ? { ...f, ...p } : f));

  const checkTun = async (on: boolean) => {
    patch({ tun_enable: on });
    if (!on) return;
    try {
      const res = await api.get<{ ok: boolean; detail: string }>("/api/tun/check");
      if (!res.ok) {
        toast.error(`TUN 环境预检异常：${res.detail}`, { duration: 7000 });
      } else {
        toast.success("TUN 软路由环境预检通过！");
      }
    } catch {
      /* 忽略 */
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.put("/api/settings", {
        tun_enable: form?.tun_enable,
        tun_stack: form?.tun_stack,
        dns_enable: form?.dns_enable,
        dns_mode: form?.dns_mode,
        dns_nameserver: form?.dns_nameserver,
        dns_fallback: form?.dns_fallback,
      });
      return api.post<{ result: string }>("/api/config/apply");
    },
    onSuccess: (res) => {
      toast.success(
        res.result === "reloaded"
          ? "透明代理配置已热重载生效！"
          : res.result === "restarted"
          ? "透明代理已生效，内核已自动重启！"
          : "设置已保存",
      );
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["core"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!form) return <div className="text-xs text-muted-foreground p-8 text-center">正在加载设置…</div>;

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Network className="h-4.5 w-4.5 text-primary" />
            透明代理与软路由模式 (TUN Mode)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            开启 auto-route 与 auto-redirect 接管全部系统及局域网流量，免客户端配置走代理
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "应用中…" : "保存并立即生效"}
        </Button>
      </div>

      {/* TUN 设置卡片 */}
      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 via-card/80 to-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold">TUN 虚拟网卡配置</CardTitle>
            <Badge variant={form.tun_enable ? "success" : "secondary"}>
              {form.tun_enable ? "TUN 已开启" : "TUN 已关闭"}
            </Badge>
          </div>
          <CardDescription>
            软路由/网关场景下开启。需要容器具备 NET_ADMIN 权限与 /dev/net/tun 设备挂载。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-card border border-border/60 shadow-xs">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">启用 TUN 透明代理</div>
              <div className="text-[11px] text-muted-foreground">
                系统将自动创建虚拟网卡并拦截路由所有流量
              </div>
            </div>
            <Switch
              checked={form.tun_enable}
              onCheckedChange={(v) => checkTun(v)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>TUN 协议栈 (Stack)</Label>
            <Select
              value={form.tun_stack}
              onChange={(e) => patch({ tun_stack: e.target.value })}
            >
              <option value="mixed">mixed（推荐，兼顾性能与兼容性）</option>
              <option value="system">system（原生系统协议栈）</option>
              <option value="gvisor">gVisor（纯用户态协议栈）</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 内置 DNS 设置 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">内置智能 DNS 与防污染解析</CardTitle>
          <CardDescription>
            配合 TUN 模式实现国内分流与海外域名 Fake-IP 防污染解析
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/60">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">启用内置 DNS 服务</div>
              <div className="text-[11px] text-muted-foreground">
                接管系统 DNS 请求并实现 Fake-IP / REDIR-HOST
              </div>
            </div>
            <Switch
              checked={form.dns_enable}
              onCheckedChange={(v) => patch({ dns_enable: v })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>DNS 模式</Label>
              <Select
                value={form.dns_mode}
                onChange={(e) => patch({ dns_mode: e.target.value })}
              >
                <option value="fake-ip">fake-ip（速度极快，推荐）</option>
                <option value="redir-host">redir-host（真实解析回退）</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>主 Nameserver (按回车换行)</Label>
              <Textarea
                value={(form.dns_nameserver || []).join("\n")}
                onChange={(e) =>
                  patch({
                    dns_nameserver: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                rows={3}
                className="font-mono text-xs"
                placeholder="223.5.5.5&#10;119.29.29.29"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
