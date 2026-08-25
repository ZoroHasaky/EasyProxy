import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Activity,
  Cable,
  Download,
  Filter,
  Pause,
  Play,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
} from "lucide-react";
import { api, AuditLog, AuditLogCategory, AuditLogLevel, AuditLogResponse } from "@/lib/api";
import { openStream } from "@/lib/ws";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface CoreLogEntry {
  type: string;
  payload: string;
  time: string;
}

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

function AuditLogDetails({ entry }: { entry: AuditLog }) {
  // 兼容旧版服务端曾省略 details 字段的历史日志，避免单条日志导致整页渲染失败。
  const details = entry.details ?? {};
  if (entry.category === "traffic") {
    const rule = [asString(details.rule), asString(details.rule_payload)].filter(Boolean).join(", ");
    const chains = asStringList(details.chains);
    return (
      <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        {rule && <div>命中规则：<span className="font-mono text-foreground/80">{rule}</span></div>}
        {chains.length > 0 && <div>代理链路：<span className="font-mono text-primary">{chains.join(" → ")}</span></div>}
      </div>
    );
  }
  const error = asString(details.error);
  if (error) return <div className="mt-2 text-[11px] text-destructive/90">原因：{error}</div>;
  return null;
}

export default function LogsPage() {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [coreLogs, setCoreLogs] = useState<CoreLogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const coreEndRef = useRef<HTMLDivElement>(null);

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
    refetchInterval: 5_000,
  });

  const entries = auditLogs.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    if (category !== "core") return;
    return openStream<CoreLogEntry>("/api/mihomo/logs?level=debug", (entry) => {
      if (paused) return;
      const time = new Date().toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setCoreLogs((previous) => [...previous.slice(-400), { ...entry, time }]);
    });
  }, [category, paused]);

  useEffect(() => {
    if (category === "core" && !paused) coreEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [category, coreLogs, paused]);

  const exportLogs = () => {
    const url = `/api/logs/export${queryString ? `?${queryString}` : ""}`;
    const link = document.createElement("a");
    link.href = url;
    link.click();
  };

  const exportCoreLogs = () => {
    const text = coreLogs.map((entry) => `[${entry.time}] [${entry.type?.toUpperCase()}] ${entry.payload}`).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `easyproxy-core-live-${Date.now()}.log`;
    link.click();
    URL.revokeObjectURL(url);
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
            访问匹配、系统操作和内核事件保留 30 天；内核原始输出仅实时展示。
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

      {category === "core" && (
        <Card className="overflow-hidden border-border/80 bg-[#090d16] p-4 font-mono text-xs text-[#d1d5db] shadow-xl">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 font-sans">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Activity className="h-4 w-4 text-amber-400" />Mihomo 实时原始输出</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPaused(!paused)}>
                {paused ? <Play className="h-3.5 w-3.5 text-emerald-500" /> : <Pause className="h-3.5 w-3.5 text-amber-500" />}
                {paused ? "继续输出" : "暂停滚动"}
              </Button>
              <Button variant="outline" size="sm" onClick={exportCoreLogs} disabled={coreLogs.length === 0}><Download className="h-3.5 w-3.5" />导出实时输出</Button>
              <Button variant="ghost" size="sm" onClick={() => setCoreLogs([])}><Trash2 className="h-3.5 w-3.5 text-rose-400" />清屏</Button>
            </div>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {coreLogs.map((entry, index) => (
              <div key={`${entry.time}-${index}`} className="flex gap-2.5 rounded px-1.5 py-0.5 leading-relaxed hover:bg-white/5">
                <span className="shrink-0 text-[11px] text-muted-foreground/60">{entry.time}</span>
                <span className="break-all text-slate-300">{entry.payload}</span>
              </div>
            ))}
            {coreLogs.length === 0 && <div className="py-8 text-center text-muted-foreground/50">等待 Mihomo 内核日志输出…</div>}
            <div ref={coreEndRef} />
          </div>
        </Card>
      )}

      <Card className="overflow-hidden border-border/80">
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Filter className="h-4 w-4 text-primary" />{CATEGORY_LABELS[category]}</div>
          <span className="text-xs text-muted-foreground">已加载 {entries.length} 条</span>
        </div>
        <div className="divide-y divide-border/60">
          {entries.map((entry) => (
            <div key={entry.id} className="p-4 transition-colors hover:bg-muted/30">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">{formatTime(entry.created_at)}</span>
                <Badge variant={categoryVariant(entry.category) as any} className="text-[10px]">{CATEGORY_LABELS[entry.category]}</Badge>
                <Badge variant={levelVariant(entry.level) as any} className="text-[10px] uppercase">{entry.level}</Badge>
              </div>
              <div className="mt-2 flex items-start gap-2 text-sm font-medium text-foreground/90">
                {entry.category === "traffic" ? <Cable className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-500" /> : <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                <span className="break-all">{entry.summary}</span>
              </div>
              <AuditLogDetails entry={entry} />
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
    </div>
  );
}
