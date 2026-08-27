import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Network,
  AlertTriangle,
} from "lucide-react";
import { api, Settings } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { defineMessages, useMessages } from "@/contexts/language";

const messages = defineMessages({
  saved: "透明代理设置已保存，等待应用", cannotEnable: "TUN 无法启用", checkFailed: "无法完成 TUN 环境预检，已取消启用",
  loading: "正在加载设置…", title: "透明代理与软路由模式",
  description: "开启 auto-route 与 auto-redirect 接管全部系统及局域网流量，免客户端配置走代理",
  tunTitle: "TUN 虚拟网卡配置", tunOn: "TUN 已开启", tunOff: "TUN 已关闭", riskTitle: "局域网转发风险提示",
  tunDescription: "软路由/网关场景下开启。需要容器具备 NET_ADMIN 权限与 /dev/net/tun 设备挂载。",
  enableTun: "启用 TUN 透明代理", enableTunHint: "系统将自动创建虚拟网卡并拦截路由所有流量", stack: "TUN 协议栈 (Stack)",
  stackMixed: "mixed（推荐，兼顾性能与兼容性）", stackSystem: "system（原生系统协议栈）", stackGvisor: "gVisor（纯用户态协议栈）",
  lanRisk: "局域网转发风险", dnsTitle: "内置智能 DNS 与防污染解析",
  dnsDescription: "配合 TUN 模式实现国内分流与海外域名 Fake-IP 防污染解析", enableDNS: "启用内置 DNS 服务",
  enableDNSHint: "接管系统 DNS 请求并实现 Fake-IP / REDIR-HOST", dnsMode: "DNS 模式",
  fakeIP: "fake-ip（速度极快，推荐）", redirHost: "redir-host（真实解析回退）",
  primaryNS: "主 Nameserver（每行一个）", fallbackNS: "备用 Nameserver（每行一个）",
}, {
  saved: "Transparent proxy settings saved and waiting to be applied", cannotEnable: "Unable to enable TUN", checkFailed: "TUN environment check failed; enabling was cancelled",
  loading: "Loading settings…", title: "Transparent Proxy & Router Mode",
  description: "Use auto-route and auto-redirect to handle system and LAN traffic without per-device proxy configuration",
  tunTitle: "TUN Virtual Interface", tunOn: "TUN Enabled", tunOff: "TUN Disabled", riskTitle: "LAN forwarding risk",
  tunDescription: "Enable for router or gateway use. The container requires NET_ADMIN and access to /dev/net/tun.",
  enableTun: "Enable TUN Transparent Proxy", enableTunHint: "Automatically create a virtual interface and route intercepted traffic", stack: "TUN Stack",
  stackMixed: "mixed (recommended for performance and compatibility)", stackSystem: "system (native system stack)", stackGvisor: "gVisor (userspace stack)",
  lanRisk: "LAN Forwarding Risk", dnsTitle: "Smart DNS & Anti-Pollution Resolution",
  dnsDescription: "Use Fake-IP with TUN routing for domestic and international domain resolution", enableDNS: "Enable Built-in DNS",
  enableDNSHint: "Handle system DNS requests with Fake-IP or REDIR-HOST", dnsMode: "DNS Mode",
  fakeIP: "fake-ip (fast, recommended)", redirHost: "redir-host (real address fallback)",
  primaryNS: "Primary Nameserver (one per line)", fallbackNS: "Fallback Nameserver (one per line)",
});
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TunCheckWarning = { severity: "warning" | "error"; message: string };
type TunCheckResponse = {
  ok: boolean;
  can_enable: boolean;
  detail: string;
  warnings?: TunCheckWarning[];
  lan_forwarding_warning?: string;
};

export default function TransparentProxyPage() {
  const text = useMessages(messages);
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(null);
  const [tunCheck, setTunCheck] = useState<TunCheckResponse | null>(null);
  const [lanForwardingWarning, setLanForwardingWarning] = useState<string | null>(null);
  const [lanForwardingDialogOpen, setLanForwardingDialogOpen] = useState(false);

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
    onSuccess: (_, payload) => {
      // 开关通过预检后静默保存，避免“成功”状态占据用户视线；其他透明代理
      // 设置仍保留原有的保存反馈。
      if (!("tun_enable" in payload)) {
        toast.success(text.saved);
      }
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["config-pending"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const blockingMessage = (res: TunCheckResponse) => {
    if (!res.ok) return res.detail;
    return res.warnings?.find((warning) => warning.severity === "error")?.message ?? res.detail;
  };

  const runTunCheck = async (silent = false): Promise<TunCheckResponse | null> => {
    try {
      const res = await api.get<TunCheckResponse>("/api/tun/check");
      setLanForwardingWarning(res.lan_forwarding_warning ?? null);
      // 预检通过无需显示任何状态；只有无法启用时才保留错误并提示用户。
      setTunCheck(res.can_enable ? null : res);
      if (!res.can_enable && !silent) {
        toast.error(`${text.cannotEnable}: ${blockingMessage(res)}`, { duration: 7000 });
      }
      return res;
    } catch {
      if (!silent) toast.error(text.checkFailed);
      return null;
    }
  };

  const checkTun = async (on: boolean) => {
    if (!on) {
      setTunCheck(null);
      patch({ tun_enable: false });
      saveMutation.mutate({ tun_enable: false });
      return;
    }
    const res = await runTunCheck();
    if (!res?.can_enable) return;
    patch({ tun_enable: true });
    saveMutation.mutate(
      { tun_enable: true },
      { onError: () => patch({ tun_enable: false }) },
    );
  };

  // 已开启状态只在环境退化时显示错误；通过预检时页面保持无提示。
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

  if (!form) return <div className="text-xs text-muted-foreground p-8 text-center">{text.loading}</div>;

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Network className="h-4.5 w-4.5 text-primary" />
            {text.title}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {text.description}
          </p>
        </div>

      </div>

      {/* TUN 设置卡片 */}
      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 via-card/80 to-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold">{text.tunTitle}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={form.tun_enable ? "success" : "secondary"}>
                {form.tun_enable ? text.tunOn : text.tunOff}
              </Badge>
              {form.tun_enable && lanForwardingWarning && (
                <button
                  type="button"
                  onClick={() => setLanForwardingDialogOpen(true)}
                  className="rounded-full p-1 text-amber-500 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  title={text.riskTitle}
                  aria-label={text.riskTitle}
                >
                  <AlertTriangle className="h-4 w-4 fill-amber-500/15" />
                </button>
              )}
            </div>
          </div>
          <CardDescription>
            {text.tunDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-card border border-border/60 shadow-xs">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">{text.enableTun}</div>
              <div className="text-[11px] text-muted-foreground">
                {text.enableTunHint}
              </div>
            </div>
            <Switch
              checked={form.tun_enable}
              onCheckedChange={(v) => checkTun(v)}
            />
          </div>

          {tunCheck && !tunCheck.can_enable && (
            <div className="space-y-1.5 text-xs">
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{blockingMessage(tunCheck)}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{text.stack}</Label>
            <Select
              value={form.tun_stack}
              onChange={(e) => {
                const tunStack = e.target.value;
                patch({ tun_stack: tunStack });
                saveMutation.mutate({ tun_stack: tunStack });
              }}
            >
              <option value="mixed">{text.stackMixed}</option>
              <option value="system">{text.stackSystem}</option>
              <option value="gvisor">{text.stackGvisor}</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Dialog open={lanForwardingDialogOpen} onOpenChange={setLanForwardingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              {text.lanRisk}
            </DialogTitle>
            <DialogDescription>{lanForwardingWarning}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {/* 内置 DNS 设置 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">{text.dnsTitle}</CardTitle>
          <CardDescription>
            {text.dnsDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/60">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold">{text.enableDNS}</div>
              <div className="text-[11px] text-muted-foreground">
                {text.enableDNSHint}
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
            <Label>{text.dnsMode}</Label>
            <Select
              value={form.dns_mode}
              onChange={(e) => {
                const dnsMode = e.target.value;
                patch({ dns_mode: dnsMode });
                saveMutation.mutate({ dns_mode: dnsMode });
              }}
            >
              <option value="fake-ip">{text.fakeIP}</option>
              <option value="redir-host">{text.redirHost}</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{text.primaryNS}</Label>
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
              <Label>{text.fallbackNS}</Label>
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
