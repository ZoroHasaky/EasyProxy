import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Pause, Play, X, XCircle, ArrowDownUp } from "lucide-react";
import { MihomoConnection, mihomo } from "@/lib/api";
import { openStream } from "@/lib/ws";
import { formatSpeed, formatBytes, formatDuration, cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface Row {
  conn: MihomoConnection;
  upSpeed: number;
  downSpeed: number;
}

export default function ConnectionsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [paused, setPaused] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"speed" | "total" | "time">("speed");
  const [live, setLive] = useState(false);
  const [summary, setSummary] = useState({ count: 0, up: 0, down: 0 });
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    let prev = new Map<string, { u: number; d: number }>();
    let lastTs = Date.now();
    return openStream("/api/ws/connections", (data) => {
      if (pausedRef.current) return;
      try {
        const p = JSON.parse(data);
        const now = Date.now();
        const dt = Math.max((now - lastTs) / 1000, 0.2);
        lastTs = now;
        const conns: MihomoConnection[] = p.connections ?? [];
        const next = new Map<string, { u: number; d: number }>();
        const out: Row[] = conns.map((c) => {
          const before = prev.get(c.id);
          const upSpeed = before ? Math.max((c.upload - before.u) / dt, 0) : 0;
          const downSpeed = before ? Math.max((c.download - before.d) / dt, 0) : 0;
          next.set(c.id, { u: c.upload, d: c.download });
          return { conn: c, upSpeed, downSpeed };
        });
        prev = next;
        setRows(out);
        setSummary({
          count: conns.length,
          up: out.reduce((s, r) => s + r.upSpeed, 0),
          down: out.reduce((s, r) => s + r.downSpeed, 0),
        });
      } catch { /* ignore */ }
    }, setLive);
  }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (q) {
      const kw = q.toLowerCase();
      list = list.filter(
        (r) =>
          (r.conn.metadata.host || r.conn.metadata.destinationIP).toLowerCase().includes(kw) ||
          r.conn.chains.join("→").toLowerCase().includes(kw) ||
          r.conn.rule.toLowerCase().includes(kw),
      );
    }
    const sorted = [...list];
    if (sort === "speed") {
      sorted.sort((a, b) => b.upSpeed + b.downSpeed - (a.upSpeed + a.downSpeed));
    } else if (sort === "total") {
      sorted.sort((a, b) => b.conn.upload + b.conn.download - (a.conn.upload + a.conn.download));
    } else {
      sorted.sort((a, b) => new Date(a.conn.start).getTime() - new Date(b.conn.start).getTime());
    }
    return sorted;
  }, [rows, q, sort]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const closeOne = async (id: string) => {
    try {
      await mihomo.closeConn(id);
      setRows((rs) => rs.filter((r) => r.conn.id !== id));
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const closeAll = async () => {
    if (!confirm(`关闭全部 ${summary.count} 条连接？`)) return;
    try {
      await mihomo.closeAllConns();
      setRows([]);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">实时连接</h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("h-2 w-2 rounded-full", live && !paused ? "bg-emerald-500 animate-pulse" : "bg-zinc-500")} />
          {live && !paused ? "实时推送中" : paused ? "已暂停" : "等待数据（需内核运行）"}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-1"><CardDescription>活跃连接</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{summary.count}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardDescription>下行速率</CardDescription></CardHeader>
          <CardContent className="text-lg text-emerald-500">{formatSpeed(summary.down)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardDescription>上行速率</CardDescription></CardHeader>
          <CardContent className="text-lg text-sky-500">{formatSpeed(summary.up)}</CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input className="w-64" placeholder="搜索主机 / 规则 / 代理链" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-40" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="speed">按速度排序</option>
          <option value="total">按总流量排序</option>
          <option value="time">按建立时间</option>
        </Select>
        <Button variant="outline" onClick={() => setPaused((p) => !p)}>
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {paused ? "恢复" : "暂停"}
        </Button>
        <Button variant="outline" onClick={() => setRows([])}>
          <ArrowDownUp className="h-4 w-4" /> 清空显示
        </Button>
        <Button variant="destructive" onClick={closeAll}>
          <XCircle className="h-4 w-4" /> 关闭全部
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="grid grid-cols-[minmax(160px,2fr)_130px_minmax(120px,1.4fr)_70px_90px_90px_90px_80px_36px] items-center border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>目标主机</span>
          <span>规则</span>
          <span>代理链</span>
          <span>协议</span>
          <span className="text-right">↑ 速度</span>
          <span className="text-right">↓ 速度</span>
          <span className="text-right">总流量</span>
          <span className="text-right">时长</span>
          <span />
        </div>
        <div ref={parentRef} className="h-[calc(100vh-430px)] min-h-[240px] overflow-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const r = filtered[vRow.index];
              const host = r.conn.metadata.host || r.conn.metadata.destinationIP;
              return (
                <div
                  key={r.conn.id}
                  className="absolute grid w-full grid-cols-[minmax(160px,2fr)_130px_minmax(120px,1.4fr)_70px_90px_90px_90px_80px_36px] items-center border-b px-3 text-xs"
                  style={{ height: vRow.size, transform: `translateY(${vRow.start}px)` }}
                >
                  <span className="truncate" title={host}>
                    {host}
                    <span className="text-muted-foreground">:{r.conn.metadata.destinationPort}</span>
                  </span>
                  <span className="truncate text-muted-foreground" title={`${r.conn.rule} ${r.conn.rulePayload}`}>
                    {r.conn.rule}{r.conn.rulePayload ? `(${r.conn.rulePayload})` : ""}
                  </span>
                  <span className="truncate" title={r.conn.chains.join(" → ")}>
                    {r.conn.chains[0] ?? "-"}
                  </span>
                  <span className="text-muted-foreground">{r.conn.metadata.network}/{r.conn.metadata.type}</span>
                  <span className="text-right text-sky-500">{r.upSpeed > 1 ? formatSpeed(r.upSpeed) : ""}</span>
                  <span className="text-right text-emerald-500">{r.downSpeed > 1 ? formatSpeed(r.downSpeed) : ""}</span>
                  <span className="text-right text-muted-foreground">
                    {formatBytes(r.conn.upload + r.conn.download)}
                  </span>
                  <span className="text-right text-muted-foreground">{formatDuration(r.conn.start)}</span>
                  <button
                    className="justify-self-end rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="关闭连接"
                    onClick={() => closeOne(r.conn.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">暂无连接</div>
          )}
        </div>
      </div>
    </div>
  );
}
