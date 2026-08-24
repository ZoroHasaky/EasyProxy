import { useEffect, useState, useRef } from "react";
import {
  Terminal,
  Trash2,
  Download,
  Play,
  Pause,
  Filter,
  Search,
  CheckCircle2,
} from "lucide-react";
import { openStream } from "@/lib/ws";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface LogEntry {
  type: string;
  payload: string;
  time: string;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filterLevel, setFilterLevel] = useState("all");
  const [search, setSearch] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return openStream<LogEntry>(
      "/api/mihomo/logs?level=debug",
      (entry) => {
        if (paused) return;
        const time = new Date().toLocaleTimeString("zh-CN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        setLogs((prev) => [...prev.slice(-400), { ...entry, time }]);
      },
    );
  }, [paused]);

  useEffect(() => {
    if (!paused) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, paused]);

  const filteredLogs = logs.filter((l) => {
    if (filterLevel !== "all" && l.type?.toLowerCase() !== filterLevel) {
      return false;
    }
    if (search.trim() && !l.payload?.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  const clearLogs = () => setLogs([]);

  const downloadLogs = () => {
    const text = logs.map((l) => `[${l.time}] [${l.type?.toUpperCase()}] ${l.payload}`).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `easyproxy-logs-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getBadgeVariant = (type: string) => {
    const t = type?.toLowerCase();
    if (t === "error") return "destructive";
    if (t === "warning") return "warning";
    if (t === "info") return "info";
    return "secondary";
  };

  return (
    <div className="space-y-4">
      {/* 头部操作栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Terminal className="h-4.5 w-4.5 text-primary" />
            内核实时日志流 (Live Logs)
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            实时捕获 Mihomo 内核输出的连接、DNS 与报错诊断日志
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play className="h-3.5 w-3.5 text-emerald-500" /> : <Pause className="h-3.5 w-3.5 text-amber-500" />}
            {paused ? "继续输出" : "暂停滚动"}
          </Button>
          <Button variant="outline" size="sm" onClick={downloadLogs} disabled={logs.length === 0}>
            <Download className="h-3.5 w-3.5" />
            导出日志
          </Button>
          <Button variant="ghost" size="sm" onClick={clearLogs}>
            <Trash2 className="h-3.5 w-3.5 text-rose-500" />
            清屏
          </Button>
        </div>
      </div>

      {/* 筛选过滤 */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索日志关键字 / 域名 / IP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>
        <div className="w-40">
          <Select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="h-9 text-xs"
          >
            <option value="all">全部级别</option>
            <option value="info">INFO</option>
            <option value="warning">WARNING</option>
            <option value="error">ERROR</option>
            <option value="debug">DEBUG</option>
          </Select>
        </div>
      </div>

      {/* 日志终端显示窗口 */}
      <Card className="bg-[#090d16] border-border/80 text-[#d1d5db] font-mono text-xs p-4 rounded-2xl h-[560px] overflow-y-auto shadow-2xl relative">
        <div className="space-y-1.5">
          {filteredLogs.map((log, idx) => (
            <div key={idx} className="flex items-start gap-2.5 hover:bg-white/5 py-0.5 px-1.5 rounded-lg transition-colors leading-relaxed">
              <span className="text-muted-foreground/60 select-none shrink-0 text-[11px]">
                {log.time}
              </span>
              <Badge
                variant={getBadgeVariant(log.type) as any}
                className="text-[10px] uppercase px-1.5 py-0 font-mono shrink-0"
              >
                {log.type}
              </Badge>
              <span className="break-all text-slate-300 select-text font-normal">
                {log.payload}
              </span>
            </div>
          ))}
          {filteredLogs.length === 0 && (
            <div className="text-center py-24 text-muted-foreground/50">
              等待内核日志输出中…
            </div>
          )}
          <div ref={endRef} />
        </div>
      </Card>
    </div>
  );
}
