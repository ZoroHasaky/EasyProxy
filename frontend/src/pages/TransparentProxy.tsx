import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Network,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";
import { api, Settings } from "@/lib/api";
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

type TunCheckWarning = { severity: "warning" | "error"; message: string };
type TunCheckResponse = { ok: boolean; detail: string; warnings?: TunCheckWarning[] };

export default function TransparentProxyPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(null);
  const [tunCheck, setTunCheck] = useState<TunCheckResponse | null>(null);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/api/settings"),
  });

  useEffect(() => {
    if (!form && settings.data) setForm({ ...settings.data });
  }, [settings.data, form]);

  const patch = (p: Partial<Settings>) => setForm((f) => (f ? { ...f, ...p } : f));

  const saveMutation = useMutation({
    mutationFn: (payload: Partial<Settings>) => api.put("/api/settings", payload),
    onSuccess: () => {
      toast.success("透明代理设置已保存，等待应用");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["config-pending"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const runTunCheck = async (silent = false) => {
    try {
      const res = await api.get<TunCheckResponse>("/api/tun/check");
      setTunCheck(res);
      if (silent) return;
      const fatal = res.warnings?.find((w) => w.severity === "error");
      if (!res.ok) {
        toast.error(`TUN 环境预检异常：${res.detail}`, { duration: 7000 });
      } else if (fatal) {
        toast.error(fatal.message, { duration: 7000 });
      } else if (res.warnings?.length) {
        toast.warning(res.warnings[0].message, { duration: 7000 });
      } else {
        toast.success("TUN 软路由环境预检通过");
      }
    } catch {
      /* 预检失败不阻止保存，统一应用时仍会给出内核错误 */
    }
  };

  const checkTun = (on: boolean) => {
    patch({ tun_enable: on });
    saveMutation.mutate({ tun_enable: on });
    if (on) runTunCheck();
  };

  // TUN 已开启时进入页面自动预检一次（静默，仅更新内联状态区）
  const tunEnabled = settings.data?.tun_enable;
  useEffect(() => {
    if (tunEnabled && tunCheck === null) runTunCheck(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tunEnabled]);

  const saveNameservers = (key: "dns_nameserver" | "dns_fallback", value: string) => {
    const servers = value.split("\n").map((item) => item.trim()).filter(Boolean);
    patch({ [key]: servers });
    saveMutation.mutate({ [key]: servers });
  };

  if (!form) return <div className="text-xs text-muted-foreground p-8 text-center">正在加载设置…</div>;

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Network className="h-4.5 w-4.5 text-primary" />
            透明代理与软路由模式
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            开启 auto-route 与 auto-redirect 接管全部系统及局域网流量，免客户端配置走代理
          </p>
        </div>

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

          {tunCheck && (
            <div className="space-y-1.5 text-xs">
              {!tunCheck.ok ? (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{tunCheck.detail}</span>
                </div>
              ) : tunCheck.warnings?.length ? (
                tunCheck.warnings.map((w, i) =>
                  w.severity === "error" ? (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{w.message}</span>
                    </div>
                  ) : (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{w.message}</span>
                    </div>
                  ),
                )
              ) : (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>环境预检通过：{tunCheck.detail}</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>TUN 协议栈 (Stack)</Label>
            <Select
              value={form.tun_stack}
              onChange={(e) => {
                const tunStack = e.target.value;
                patch({ tun_stack: tunStack });
                saveMutation.mutate({ tun_stack: tunStack });
              }}
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
              onCheckedChange={(v) => {
                patch({ dns_enable: v });
                saveMutation.mutate({ dns_enable: v });
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>DNS 模式</Label>
            <Select
              value={form.dns_mode}
              onChange={(e) => {
                const dnsMode = e.target.value;
                patch({ dns_mode: dnsMode });
                saveMutation.mutate({ dns_mode: dnsMode });
              }}
            >
              <option value="fake-ip">fake-ip（速度极快，推荐）</option>
              <option value="redir-host">redir-host（真实解析回退）</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                onBlur={(e) => saveNameservers("dns_nameserver", e.currentTarget.value)}
                rows={3}
                className="font-mono text-xs"
                placeholder="223.5.5.5&#10;119.29.29.29"
              />
            </div>

            <div className="space-y-1.5">
              <Label>备用 Nameserver (按回车换行)</Label>
              <Textarea
                value={(form.dns_fallback || []).join("\n")}
                onChange={(e) =>
                  patch({
                    dns_fallback: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                onBlur={(e) => saveNameservers("dns_fallback", e.currentTarget.value)}
                rows={3}
                className="font-mono text-xs"
                placeholder="https://dns.cloudflare.com/dns-query&#10;https://dns.google/dns-query"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
