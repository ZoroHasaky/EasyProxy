import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { useConfigApply } from "@/contexts/config-apply-state";
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

const SCOPE_LABELS: Record<string, string> = {
  kernel_network: "内核网络",
  transparent_proxy: "透明代理与 DNS",
  geo: "Geo 数据",
  nodes: "节点池",
  subscriptions: "订阅",
  groups: "出站规则",
  recognition_rules: "识别规则",
  outbound_rules: "出站映射",
};

const FIELD_LABELS: Record<string, string> = {
  mixed_port: "混合端口",
  allow_lan: "允许局域网访问",
  log_level: "日志级别",
  tun_enable: "启用 TUN",
  tun_stack: "TUN 协议栈",
  dns_enable: "启用 DNS",
  dns_mode: "DNS 模式",
  dns_nameserver: "主 Nameserver",
  dns_fallback: "备用 Nameserver",
  geo_enabled: "启用 Geo 数据",
  geo_auto_update: "自动更新 Geo 数据",
  geo_update_interval: "Geo 更新周期",
  geox_urls: "Geo 数据源",
};

function formatTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString("zh-CN", { hour12: false });
}

export function PendingConfigDialog() {
  const { pending, dialogOpen, setDialogOpen, isApplying, apply, refresh } = useConfigApply();
  const items = pending?.items ?? [];
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>待应用配置</DialogTitle>
          <DialogDescription>
            以下设置已保存但尚未进入运行中的 Mihomo 内核。节点与规则的自动应用失败也会在此处重试。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5 py-1">
          {items.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
              当前没有待应用配置
            </div>
          ) : items.map((item) => (
            <div key={item.scope} className="rounded-xl border border-border/60 bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {item.status === "failed" ? <AlertTriangle className="h-4 w-4 text-rose-500" /> : <Clock3 className="h-4 w-4 text-amber-500" />}
                  {SCOPE_LABELS[item.scope] ?? item.scope}
                </div>
                <Badge variant={item.status === "failed" ? "destructive" : "warning"}>
                  {item.status === "failed" ? "等待重试" : "等待应用"}
                </Badge>
              </div>
              {item.fields.length > 0 && <div className="mt-2 text-xs text-muted-foreground">{item.fields.map((field) => FIELD_LABELS[field] ?? field).join("、")}</div>}
              {item.last_error && <div className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive">上次失败：{item.last_error}</div>}
              <div className="mt-2 text-[11px] text-muted-foreground">最近修改：{formatTime(item.updated_at)}</div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => refresh()} disabled={isApplying}>
            <RefreshCw className="h-3.5 w-3.5" />刷新
          </Button>
          <Button size="sm" onClick={() => apply()} disabled={items.length === 0 || isApplying}>
            {isApplying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {isApplying ? "应用中…" : "全部应用"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
