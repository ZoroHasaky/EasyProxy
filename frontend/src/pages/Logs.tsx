import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Activity,
  Cable,
  Download,
  Eye,
  Filter,
  RefreshCw,
  Search,
  Terminal,
} from "lucide-react";
import { api, AuditLog, AuditLogCategory, AuditLogLevel, AuditLogResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { defineMessages, formatMessage, useLanguage, useMessages } from "@/contexts/language";

type CategoryFilter = "all" | AuditLogCategory;
type LevelFilter = "all" | AuditLogLevel;

const messages = defineMessages({
  allLogs: "全部日志", traffic: "访问匹配", operation: "系统操作", core: "内核日志",
  allLevels: "全部级别", success: "成功", info: "信息", warning: "警告", error: "错误",
  matchedRule: "命中规则", proxyRoute: "代理链路", reason: "原因", title: "日志查看",
  description: "访问匹配、系统操作和 Mihomo 原始输出均保留 30 天。", export: "导出筛选日志",
  search: "搜索域名、规则、策略组、节点或操作名称…", loaded: "已加载 {count} 条", view: "查看完整日志",
  loading: "正在读取日志…", loadFailed: "日志读取失败，请稍后重试。", empty: "暂无符合条件的日志",
  loadingMore: "加载中…", loadMore: "加载更多", detailTitle: "日志详情", detailDescription: "查看该条日志的完整内容。",
  eventCode: "事件编码", summary: "日志摘要", notRecorded: "未记录", failureDetail: "失败详情",
  trafficSummary: "访问 {target} → {route}",
  operationFallback: "系统操作：{event}", panelStarted: "EasyProxy 面板已启动", scheduledSubscriptionRefresh: "订阅定时刷新",
  geoRecognitionGeneration: "根据 Geo 数据生成识别规则", quickGeoRoutingGeneration: "一键生成 Geo 路由", initialPassword: "已生成首次管理员密码",
  administratorLogin: "管理员登录", subscriptionChanged: "订阅配置已更新", subscriptionRefresh: "订阅已刷新",
  nodesImported: "节点已导入", batchDelayTest: "节点批量测速已执行", delayTest: "节点测速已执行", nodesChanged: "节点配置已更新",
  recognitionChanged: "识别规则已更新", recognitionImported: "YAML 识别规则已导入", outboundChanged: "出站映射已更新",
  groupChanged: "节点组合已更新", regionGroupsGenerated: "地区节点组合已生成", configurationApplied: "待应用配置已执行",
  configLinkRotated: "配置订阅链接已重新生成", settingsSaved: "系统设置已保存", passwordChanged: "管理密码已修改",
  administratorLogout: "管理员已退出登录", backupRestored: "备份恢复已执行", panelOperation: "面板操作已执行",
  coreRuntimeChanged: "内核运行配置已调整", panelUpdate: "面板版本升级", panelRestart: "面板升级重启", geoDataRefreshed: "Geo 数据库已刷新",
}, {
  allLogs: "All Logs", traffic: "Traffic Matches", operation: "System Operations", core: "Kernel Logs",
  allLevels: "All Levels", success: "Success", info: "Info", warning: "Warning", error: "Error",
  matchedRule: "Matched Rule", proxyRoute: "Proxy Route", reason: "Reason", title: "Logs",
  description: "Traffic matches, system operations, and raw Mihomo output are retained for 30 days.", export: "Export Filtered Logs",
  search: "Search domains, rules, proxy groups, nodes, or operations…", loaded: "{count} loaded", view: "View Full Log",
  loading: "Loading logs…", loadFailed: "Failed to load logs. Please try again later.", empty: "No matching logs",
  loadingMore: "Loading…", loadMore: "Load More", detailTitle: "Log Details", detailDescription: "View the complete content of this log entry.",
  eventCode: "Event Code", summary: "Log Summary", notRecorded: "Not Recorded", failureDetail: "Failure Details",
  trafficSummary: "Access {target} → {route}",
  operationFallback: "System operation: {event}", panelStarted: "EasyProxy Started", scheduledSubscriptionRefresh: "Scheduled Subscription Refresh",
  geoRecognitionGeneration: "Geo Recognition Rule Generation", quickGeoRoutingGeneration: "Quick Geo Routing Generation", initialPassword: "Initial Administrator Password Generated",
  administratorLogin: "Administrator Sign-in", subscriptionChanged: "Subscription Configuration Updated", subscriptionRefresh: "Subscription Refreshed",
  nodesImported: "Nodes Imported", batchDelayTest: "Batch Node Delay Test", delayTest: "Node Delay Test", nodesChanged: "Node Configuration Updated",
  recognitionChanged: "Recognition Rules Updated", recognitionImported: "YAML Recognition Rules Imported", outboundChanged: "Outbound Mapping Updated",
  groupChanged: "Node Groups Updated", regionGroupsGenerated: "Regional Node Groups Generated", configurationApplied: "Pending Configuration Applied",
  configLinkRotated: "Configuration Subscription Link Regenerated", settingsSaved: "System Settings Saved", passwordChanged: "Management Password Changed",
  administratorLogout: "Administrator Signed Out", backupRestored: "Backup Restored", panelOperation: "Panel Operation Completed",
  coreRuntimeChanged: "Core Runtime Configuration Updated", panelUpdate: "Panel Update", panelRestart: "Panel Update Restart", geoDataRefreshed: "Geo Data Refreshed",
});

const CATEGORY_LABEL_KEYS: Record<CategoryFilter, keyof typeof messages["zh-CN"]> = {
  all: "allLogs",
  traffic: "traffic",
  operation: "operation",
  core: "core",
};

const LEVEL_LABEL_KEYS: Record<LevelFilter, keyof typeof messages["zh-CN"]> = {
  all: "allLevels",
  success: "success",
  info: "info",
  warning: "warning",
  error: "error",
};

const OPERATION_EVENT_LABEL_KEYS: Record<string, keyof typeof messages["zh-CN"]> = {
  "panel.started": "panelStarted",
  "subscription.scheduled_refresh": "scheduledSubscriptionRefresh",
  "routing.geo_generate": "geoRecognitionGeneration",
  "routing.geo_quick_generate": "quickGeoRoutingGeneration",
  "security.initial_password": "initialPassword",
  "security.login": "administratorLogin",
  "subscription.changed": "subscriptionChanged",
  "subscription.refresh": "subscriptionRefresh",
  "node.import": "nodesImported",
  "node.batch_delay": "batchDelayTest",
  "node.delay": "delayTest",
  "node.changed": "nodesChanged",
  "routing.recognition": "recognitionChanged",
  "routing.recognition_import": "recognitionImported",
  "routing.outbound": "outboundChanged",
  "routing.group": "groupChanged",
  "routing.region_groups": "regionGroupsGenerated",
  "config.apply": "configurationApplied",
  "config_export.link_rotate": "configLinkRotated",
  "settings.changed": "settingsSaved",
  "security.password": "passwordChanged",
  "security.logout": "administratorLogout",
  "backup.restore": "backupRestored",
  "panel.mutation": "panelOperation",
  "core.runtime": "coreRuntimeChanged",
  "panel.update": "panelUpdate",
  "panel.update_restart": "panelRestart",
  "geo.refresh": "geoDataRefreshed",
};

function levelVariant(level: string) {
  if (level === "error") return "destructive";
  if (level === "warning") return "warning";
  if (level === "success") return "success";
  return "info";
}

function categoryVariant(category: AuditLogCategory) {
  if (category === "traffic") return "purple";
  if (category === "core") return "warning";
  return "secondary";
}

function formatTime(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, { hour12: false });
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getTrafficTrace(details?: Record<string, unknown>) {
  const safeDetails = details ?? {};
  return {
    rule: [asString(safeDetails.rule), asString(safeDetails.rule_payload)].filter(Boolean).join(", "),
    // Mihomo 返回的 Chains 从实际节点向上回溯到入口策略组；界面按实际出站方向展示。
    route: asStringList(safeDetails.chains).reverse().join(" → "),
  };
}

function formatTrafficSummary(entry: AuditLog, text: { trafficSummary: string }) {
  const details = entry.details ?? {};
  const target = asString(details.target);
  if (!target) return entry.summary;

  const port = asString(details.port);
  const chains = asStringList(details.chains);
  const route = chains[chains.length - 1];
  if (!route) return entry.summary;

  return formatMessage(text.trafficSummary, { target: `${target}${port ? `:${port}` : ""}`, route });
}

function formatAuditSummary(
  entry: AuditLog,
  text: Record<keyof typeof messages["zh-CN"], string>,
  language: "zh-CN" | "en",
) {
  if (entry.category === "traffic") return formatTrafficSummary(entry, text);
  if (language !== "en" || entry.category !== "operation" || !/[\u3400-\u9fff]/.test(entry.summary)) return entry.summary;

  const eventLabel = OPERATION_EVENT_LABEL_KEYS[entry.event];
  return eventLabel ? text[eventLabel] : formatMessage(text.operationFallback, { event: entry.event });
}

function AuditLogDetails({ entry }: { entry: AuditLog }) {
  const text = useMessages(messages);
  // 兼容旧版服务端曾省略 details 字段的历史日志，避免单条日志导致整页渲染失败。
  const details = entry.details ?? {};
  if (entry.category === "traffic") {
    const { rule, route } = getTrafficTrace(details);
    return (
      <>
        {rule && <span className="text-muted-foreground"> · {text.matchedRule}: <span className="font-mono text-foreground/80">{rule}</span></span>}
        {route && <span className="text-muted-foreground"> · {text.proxyRoute}: <span className="font-mono text-primary">{route}</span></span>}
      </>
    );
  }
  const error = asString(details.error);
  if (error) return <span className="text-destructive/90"> · {text.reason}: {error}</span>;
  return null;
}

export default function LogsPage() {
  const text = useMessages(messages);
  const { language, locale } = useLanguage();
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<AuditLog | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (category !== "all") params.set("category", category);
    if (level !== "all") params.set("level", level);
    if (search.trim()) params.set("q", search.trim());
    return params.toString();
  }, [category, level, search]);

  const auditLogs = useInfiniteQuery({
    queryKey: ["audit-logs", queryString],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(queryString);
      params.set("limit", "100");
      if (pageParam) params.set("before", String(pageParam));
      return api.get<AuditLogResponse>(`/api/logs?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => lastPage.next_before || undefined,
    refetchInterval: category === "core" ? 1_500 : 5_000,
  });

  const entries = auditLogs.data?.pages.flatMap((page) => page.items) ?? [];

  const exportLogs = () => {
    const url = `/api/logs/export${queryString ? `?${queryString}` : ""}`;
    const link = document.createElement("a");
    link.href = url;
    link.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
            <Terminal className="h-4.5 w-4.5 text-primary" />
            {text.title}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {text.description}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportLogs} disabled={entries.length === 0}>
          <Download className="h-3.5 w-3.5" />
          {text.export}
        </Button>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={text.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 pl-9 text-xs"
          />
        </div>
        <div className="w-full sm:w-40">
          <Select value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)} className="h-9 text-xs">
            {(Object.keys(CATEGORY_LABEL_KEYS) as CategoryFilter[]).map((value) => <option key={value} value={value}>{text[CATEGORY_LABEL_KEYS[value]]}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-36">
          <Select value={level} onChange={(event) => setLevel(event.target.value as LevelFilter)} className="h-9 text-xs">
            {(Object.keys(LEVEL_LABEL_KEYS) as LevelFilter[]).map((value) => <option key={value} value={value}>{text[LEVEL_LABEL_KEYS[value]]}</option>)}
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden border-border/80">
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Filter className="h-4 w-4 text-primary" />{text[CATEGORY_LABEL_KEYS[category]]}</div>
          <span className="text-xs text-muted-foreground">{text.loaded.replace("{count}", String(entries.length))}</span>
        </div>
        <div className="divide-y divide-border/60">
          {entries.map((entry) => (
            <div key={entry.id} className="flex min-w-0 items-center gap-2 overflow-hidden px-4 py-2.5 text-xs transition-colors hover:bg-muted/30">
              <Button
                variant="ghost"
                size="iconSm"
                className="shrink-0 text-muted-foreground hover:text-primary"
                title={text.view}
                onClick={() => setSelectedEntry(entry)}
              >
                <Eye className="h-3.5 w-3.5" />
                <span className="sr-only">{text.view}</span>
              </Button>
              <span className="shrink-0 font-mono text-muted-foreground">{formatTime(entry.created_at, locale)}</span>
              <Badge variant={categoryVariant(entry.category) as any} className="shrink-0 text-[10px]">{text[CATEGORY_LABEL_KEYS[entry.category]]}</Badge>
              <Badge variant={levelVariant(entry.level) as any} className="shrink-0 text-[10px]">{text[LEVEL_LABEL_KEYS[entry.level]]}</Badge>
              {entry.category === "traffic" ? <Cable className="h-3.5 w-3.5 shrink-0 text-purple-500" /> : <Activity className="h-3.5 w-3.5 shrink-0 text-primary" />}
              <div className="min-w-0 flex-1 truncate whitespace-nowrap" title={formatAuditSummary(entry, text, language)}>
                <span className="font-medium text-foreground/90">{formatAuditSummary(entry, text, language)}</span>
                <AuditLogDetails entry={entry} />
              </div>
            </div>
          ))}
          {auditLogs.isLoading && <div className="p-10 text-center text-xs text-muted-foreground">{text.loading}</div>}
          {auditLogs.isError && <div className="p-10 text-center text-xs text-destructive">{text.loadFailed}</div>}
          {!auditLogs.isLoading && !auditLogs.isError && entries.length === 0 && <div className="p-12 text-center text-xs text-muted-foreground">{text.empty}</div>}
        </div>
        {auditLogs.hasNextPage && (
          <div className="border-t border-border/60 p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => auditLogs.fetchNextPage()} disabled={auditLogs.isFetchingNextPage}>
              <RefreshCw className={`h-3.5 w-3.5 ${auditLogs.isFetchingNextPage ? "animate-spin" : ""}`} />
              {auditLogs.isFetchingNextPage ? text.loadingMore : text.loadMore}
            </Button>
          </div>
        )}
      </Card>

      <Dialog open={Boolean(selectedEntry)} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{text.detailTitle}</DialogTitle>
            <DialogDescription>{text.detailDescription}</DialogDescription>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={categoryVariant(selectedEntry.category) as any}>{text[CATEGORY_LABEL_KEYS[selectedEntry.category]]}</Badge>
                <Badge variant={levelVariant(selectedEntry.level) as any}>{text[LEVEL_LABEL_KEYS[selectedEntry.level]]}</Badge>
                <span className="font-mono text-muted-foreground">{formatTime(selectedEntry.created_at, locale)}</span>
              </div>
              <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 sm:grid-cols-[96px_minmax(0,1fr)]">
                <span className="text-muted-foreground">{text.eventCode}</span>
                <span className="break-all font-mono text-foreground/90">{selectedEntry.event}</span>
                <span className="text-muted-foreground">{text.summary}</span>
                <span className="whitespace-pre-wrap break-words font-medium text-foreground/90">{formatAuditSummary(selectedEntry, text, language)}</span>
              </div>
              {selectedEntry.category === "traffic" && (() => {
                const { rule, route } = getTrafficTrace(selectedEntry.details);
                return (
                  <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 sm:grid-cols-[96px_minmax(0,1fr)]">
                    <span className="text-muted-foreground">{text.matchedRule}</span>
                    <span className="whitespace-pre-wrap break-all font-mono text-foreground/90">{rule || text.notRecorded}</span>
                    <span className="text-muted-foreground">{text.proxyRoute}</span>
                    <span className="whitespace-pre-wrap break-all font-mono text-primary">{route || text.notRecorded}</span>
                  </div>
                );
              })()}
              {selectedEntry.category !== "traffic" && asString(selectedEntry.details?.error) && (
                <div className="grid gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3 sm:grid-cols-[96px_minmax(0,1fr)]">
                  <span className="text-muted-foreground">{text.failureDetail}</span>
                  <span className="whitespace-pre-wrap break-words font-mono text-destructive/90">{asString(selectedEntry.details?.error)}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
