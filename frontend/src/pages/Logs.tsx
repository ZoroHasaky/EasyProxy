import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Pause, Play, Eraser } from "lucide-react";
import { openStream } from "@/lib/ws";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const LEVELS = ["silent", "error", "warning", "info", "debug"];

export default function LogsPage() {
  const [level, setLevel] = useState("info");
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    setLines([]);
    return openStream(`/api/ws/logs?level=${level}`, (data) => {
      if (pausedRef.current) return;
      try {
        const p = JSON.parse(data);
        const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
        const text = typeof p.payload === "string" ? p.payload : JSON.stringify(p.payload);
        setLines((ls) => [...ls.slice(-500), `${ts} [${p.type ?? level}] ${text}`]);
      } catch { /* ignore */ }
    });
  }, [level]);

  useEffect(() => {
    if (autoScroll && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">内核日志</h1>
        <div className="flex items-center gap-2">
          <Select className="w-32" value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
          <Button variant="outline" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? "恢复" : "暂停"}
          </Button>
          <Button variant="outline" onClick={() => setLines([])}>
            <Eraser className="h-4 w-4" /> 清空
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            自动滚动
          </label>
        </div>
      </div>
      <div
        ref={boxRef}
        className="h-[calc(100vh-220px)] overflow-auto rounded-lg border bg-black/40 p-3 font-mono text-xs leading-5"
      >
        {lines.length === 0 && (
          <div className={cn("py-8 text-center text-muted-foreground", paused && "animate-pulse")}>
            {paused ? "已暂停" : "等待日志（需内核运行）…"}
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={
            l.includes("[error]") ? "text-red-400" :
            l.includes("[warning]") ? "text-amber-400" :
            l.includes("[debug]") ? "text-zinc-500" : "text-zinc-300"
          }>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
