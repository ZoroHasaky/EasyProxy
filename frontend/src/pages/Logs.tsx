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

type CategoryFilter = "all" | AuditLogCategory;
type LevelFilter = "all" | AuditLogLevel;

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: "全部日志",
  traffic: "访问匹配",
  operation: "系统操作",
  core: "内核日志",
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

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
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

function AuditLogDetails({ entry }: { entry: AuditLog }) {
  // 兼容旧版服务端曾省略 details 字段的历史日志，避免单条日志导致整页渲染失败。
  const details = entry.details ?? {};
  if (entry.category === "traffic") {
    const { rule, route } = getTrafficTrace(details);
    return (
      <>
        {rule && <span className="text-muted-foreground"> · 命中规则：<span className="font-mono text-foreground/80">{rule}</span></span>}
        {route && <span className="text-muted-foreground"> · 代理链路：<span className="font-mono text-primary">{route}</span></span>}
      </>
    );
  }
  const error = asString(details.error);
  if (error) return <span className="text-destructive/90"> · 原因：{error}</span>;
  return null;
}

export default function LogsPage() {
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
            日志查看
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            访问匹配、系统操作和 Mihomo 原始输出均保留 30 天。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportLogs} disabled={entries.length === 0}>
          <Download className="h-3.5 w-3.5" />
          导出筛选日志
        </Button>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索域名、规则、策略组、节点或操作名称…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 pl-9 text-xs"
          />
        </div>
        <div className="w-full sm:w-40">
          <Select value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)} className="h-9 text-xs">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-36">
          <Select value={level} onChange={(event) => setLevel(event.target.value as LevelFilter)} className="h-9 text-xs">
            <option value="all">全部级别</option>
            <option value="success">成功</option>
            <option value="info">信息</option>
            <option value="warning">警告</option>
            <option value="error">错误</option>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden border-border/80">
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Filter className="h-4 w-4 text-primary" />{CATEGORY_LABELS[category]}</div>
          <span className="text-xs text-muted-foreground">已加载 {entries.length} 条</span>
        </div>
        <div className="divide-y divide-border/60">
          {entries.map((entry) => (
            <div key={entry.id} className="flex min-w-0 items-center gap-2 overflow-hidden px-4 py-2.5 text-xs transition-colors hover:bg-muted/30">
              <Button
                variant="ghost"
                size="iconSm"
                className="shrink-0 text-muted-foreground hover:text-primary"
                title="查看完整日志"
                onClick={() => setSelectedEntry(entry)}
              >
                <Eye className="h-3.5 w-3.5" />
                <span className="sr-only">查看完整日志</span>
              </Button>
              <span className="shrink-0 font-mono text-muted-foreground">{formatTime(entry.created_at)}</span>
              <Badge variant={categoryVariant(entry.category) as any} className="shrink-0 text-[10px]">{CATEGORY_LABELS[entry.category]}</Badge>
              <Badge variant={levelVariant(entry.level) as any} className="shrink-0 text-[10px] uppercase">{entry.level}</Badge>
              {entry.category === "traffic" ? <Cable className="h-3.5 w-3.5 shrink-0 text-purple-500" /> : <Activity className="h-3.5 w-3.5 shrink-0 text-primary" />}
              <div className="min-w-0 flex-1 truncate whitespace-nowrap" title={entry.summary}>
                <span className="font-medium text-foreground/90">{entry.summary}</span>
                <AuditLogDetails entry={entry} />
              </div>
            </div>
          ))}
          {auditLogs.isLoading && <div className="p-10 text-center text-xs text-muted-foreground">正在读取日志…</div>}
          {auditLogs.isError && <div className="p-10 text-center text-xs text-destructive">日志读取失败，请稍后重试。</div>}
          {!auditLogs.isLoading && !auditLogs.isError && entries.length === 0 && <div className="p-12 text-center text-xs text-muted-foreground">暂无符合条件的日志</div>}
        </div>
        {auditLogs.hasNextPage && (
          <div className="border-t border-border/60 p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => auditLogs.fetchNextPage()} disabled={auditLogs.isFetchingNextPage}>
              <RefreshCw className={`h-3.5 w-3.5 ${auditLogs.isFetchingNextPage ? "animate-spin" : ""}`} />
              {auditLogs.isFetchingNextPage ? "加载中…" : "加载更多"}
            </Button>
          </div>
        )}
      </Card>

      <Dialog open={Boolean(selectedEntry)} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>日志详情</DialogTitle>
            <DialogDescription>查看该条日志的完整内容。</DialogDescription>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={categoryVariant(selectedEntry.category) as any}>{CATEGORY_LABELS[selectedEntry.category]}</Badge>
                <Badge variant={levelVariant(selectedEntry.level) as any} className="uppercase">{selectedEntry.level}</Badge>
                <span className="font-mono text-muted-foreground">{formatTime(selectedEntry.created_at)}</span>
              </div>
              <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 sm:grid-cols-[96px_minmax(0,1fr)]">
                <span className="text-muted-foreground">事件编码</span>
                <span className="break-all font-mono text-foreground/90">{selectedEntry.event}</span>
                <span className="text-muted-foreground">日志摘要</span>
                <span className="whitespace-pre-wrap break-words font-medium text-foreground/90">{selectedEntry.summary}</span>
              </div>
              {selectedEntry.category === "traffic" && (() => {
                const { rule, route } = getTrafficTrace(selectedEntry.details);
                return (
                  <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 sm:grid-cols-[96px_minmax(0,1fr)]">
                    <span className="text-muted-foreground">命中规则</span>
                    <span className="whitespace-pre-wrap break-all font-mono text-foreground/90">{rule || "未记录"}</span>
                    <span className="text-muted-foreground">代理链路</span>
                    <span className="whitespace-pre-wrap break-all font-mono text-primary">{route || "未记录"}</span>
                  </div>
                );
              })()}
              {selectedEntry.category !== "traffic" && asString(selectedEntry.details?.error) && (
                <div className="grid gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3 sm:grid-cols-[96px_minmax(0,1fr)]">
                  <span className="text-muted-foreground">失败详情</span>
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
