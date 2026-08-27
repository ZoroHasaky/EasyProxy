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
import { defineMessages, useLanguage, useMessages } from "@/contexts/language";

const SCOPE_LABELS = {
  kernel_network: "scopeKernel", transparent_proxy: "scopeTun", geo: "scopeGeo", nodes: "scopeNodes",
  subscriptions: "scopeSubscriptions", groups: "scopeGroups", recognition_rules: "scopeRecognition", outbound_rules: "scopeOutbound",
} as const;

const FIELD_LABELS = {
  mixed_port: "fieldPort", allow_lan: "fieldLan", log_level: "fieldLog", tun_enable: "fieldTun",
  tun_stack: "fieldStack", dns_enable: "fieldDNS", dns_mode: "fieldDNSMode", dns_nameserver: "fieldNameserver",
  dns_fallback: "fieldFallback", geo_enabled: "fieldGeo", geo_auto_update: "fieldGeoAuto",
  geo_update_interval: "fieldGeoInterval", geox_urls: "fieldGeoSource",
} as const;

const messages = defineMessages({
  scopeKernel: "内核网络", scopeTun: "透明代理与 DNS", scopeGeo: "Geo 数据", scopeNodes: "节点池",
  scopeSubscriptions: "订阅", scopeGroups: "节点组合", scopeRecognition: "识别规则", scopeOutbound: "出站映射",
  fieldPort: "混合端口", fieldLan: "允许局域网访问", fieldLog: "日志级别", fieldTun: "启用 TUN",
  fieldStack: "TUN 协议栈", fieldDNS: "启用 DNS", fieldDNSMode: "DNS 模式", fieldNameserver: "主 Nameserver",
  fieldFallback: "备用 Nameserver", fieldGeo: "启用 Geo 数据", fieldGeoAuto: "自动更新 Geo 数据",
  fieldGeoInterval: "Geo 更新周期", fieldGeoSource: "Geo 数据源", title: "待应用配置",
  description: "以下设置已保存但尚未进入运行中的 Mihomo 内核。节点与规则的自动应用失败也会在此处重试。",
  empty: "当前没有待应用配置", retry: "等待重试", pending: "等待应用", lastFailed: "上次失败",
  modified: "最近修改", refresh: "刷新", applying: "应用中…", applyAll: "全部应用",
}, {
  scopeKernel: "Kernel Network", scopeTun: "Transparent Proxy & DNS", scopeGeo: "Geo Data", scopeNodes: "Nodes",
  scopeSubscriptions: "Subscriptions", scopeGroups: "Node Groups", scopeRecognition: "Recognition Rules", scopeOutbound: "Outbound Mappings",
  fieldPort: "Mixed Port", fieldLan: "Allow LAN Access", fieldLog: "Log Level", fieldTun: "Enable TUN",
  fieldStack: "TUN Stack", fieldDNS: "Enable DNS", fieldDNSMode: "DNS Mode", fieldNameserver: "Primary Nameserver",
  fieldFallback: "Fallback Nameserver", fieldGeo: "Enable Geo Data", fieldGeoAuto: "Auto-update Geo Data",
  fieldGeoInterval: "Geo Update Interval", fieldGeoSource: "Geo Data Source", title: "Pending Changes",
  description: "These settings are saved but have not entered the running Mihomo kernel. Failed automatic node and rule applications can also be retried here.",
  empty: "There are no pending changes", retry: "Waiting to Retry", pending: "Waiting to Apply", lastFailed: "Last failure",
  modified: "Last modified", refresh: "Refresh", applying: "Applying…", applyAll: "Apply All",
});

function formatTime(value: string, locale: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString(locale, { hour12: false });
}

export function PendingConfigDialog() {
  const text = useMessages(messages);
  const { language, locale } = useLanguage();
  const { pending, dialogOpen, setDialogOpen, isApplying, apply, refresh } = useConfigApply();
  const items = pending?.items ?? [];
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>
            {text.description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5 py-1">
          {items.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
              {text.empty}
            </div>
          ) : items.map((item) => (
            <div key={item.scope} className="rounded-xl border border-border/60 bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {item.status === "failed" ? <AlertTriangle className="h-4 w-4 text-rose-500" /> : <Clock3 className="h-4 w-4 text-amber-500" />}
                  {item.scope in SCOPE_LABELS ? text[SCOPE_LABELS[item.scope as keyof typeof SCOPE_LABELS]] : item.scope}
                </div>
                <Badge variant={item.status === "failed" ? "destructive" : "warning"}>
                  {item.status === "failed" ? text.retry : text.pending}
                </Badge>
              </div>
              {item.fields.length > 0 && <div className="mt-2 text-xs text-muted-foreground">{item.fields.map((field) => field in FIELD_LABELS ? text[FIELD_LABELS[field as keyof typeof FIELD_LABELS]] : field).join(language === "zh-CN" ? "、" : ", ")}</div>}
              {item.last_error && <div className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive">{text.lastFailed}: {item.last_error}</div>}
              <div className="mt-2 text-[11px] text-muted-foreground">{text.modified}: {formatTime(item.updated_at, locale)}</div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => refresh()} disabled={isApplying}>
            <RefreshCw className="h-3.5 w-3.5" />{text.refresh}
          </Button>
          <Button size="sm" onClick={() => apply()} disabled={items.length === 0 || isApplying}>
            {isApplying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {isApplying ? text.applying : text.applyAll}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
