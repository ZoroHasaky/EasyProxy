import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Cable,
  Search,
  Trash2,
  XCircle,
  ArrowDown,
  ArrowUp,
  Filter,
  RefreshCw,
  Clock,
  Radio,
} from "lucide-react";
import { api, mihomo, MihomoConnection } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { formatSpeed } from "@/lib/utils";

type ConnectionSpeed = { up: number; down: number };
type ConnectionSample = ConnectionSpeed & { at: number };
const EMPTY_CONNECTIONS: MihomoConnection[] = [];

export default function ConnectionsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"speed" | "time">("speed");
  const [connectionSpeeds, setConnectionSpeeds] = useState<Record<string, ConnectionSpeed>>({});
  const speedSamplesRef = useRef<Map<string, ConnectionSample>>(new Map());

  const connsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      return api.get<{
        connections: MihomoConnection[] | null;
        uploadTotal: number;
        downloadTotal: number;
      }>("/api/mihomo/connections");
    },
    refetchInterval: 2000,
  });

  const rawConns = connsQuery.data?.connections ?? EMPTY_CONNECTIONS;

  useEffect(() => {
    const now = Date.now();
    const previousSamples = speedSamplesRef.current;
    const nextSamples = new Map<string, ConnectionSample>();
    const nextSpeeds: Record<string, ConnectionSpeed> = {};

    for (const connection of rawConns) {
      const up = Math.max(0, Number(connection.upload) || 0);
      const down = Math.max(0, Number(connection.download) || 0);
      const previous = previousSamples.get(connection.id);
      const elapsedSeconds = previous ? Math.max((now - previous.at) / 1000, 0.001) : 0;
      nextSpeeds[connection.id] = previous
        ? {
            up: Math.max(0, (up - previous.up) / elapsedSeconds),
            down: Math.max(0, (down - previous.down) / elapsedSeconds),
          }
        : { up: 0, down: 0 };
      nextSamples.set(connection.id, { up, down, at: now });
    }

    speedSamplesRef.current = nextSamples;
    setConnectionSpeeds(nextSpeeds);
  }, [rawConns]);

  const closeOne = async (id: string) => {
    try {
      await mihomo.closeConn(id);
      toast.success("已断开该连接");
      qc.invalidateQueries({ queryKey: ["connections"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const closeAll = async () => {
    if (!confirm("确定要关闭所有活动连接吗？")) return;
    try {
      await mihomo.closeAllConns();
      toast.success("所有连接已断开");
      qc.invalidateQueries({ queryKey: ["connections"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const filtered = useMemo(() => {
    let list = rawConns.filter((c) => {
      if (!search.trim()) return true;
      const kw = search.toLowerCase();
      const host = (c.metadata?.host || "").toLowerCase();
      const dip = (c.metadata?.destinationIP || "").toLowerCase();
      const sip = (c.metadata?.sourceIP || "").toLowerCase();
      const proc = (c.metadata?.process || "").toLowerCase();
      const rule = (c.rule || "").toLowerCase();
      const chain = (c.chains || []).join(" ").toLowerCase();
      return host.includes(kw) || dip.includes(kw) || sip.includes(kw) || proc.includes(kw) || rule.includes(kw) || chain.includes(kw);
    });

    list.sort((a, b) => {
      if (sortBy === "speed") {
        const sa = (a.download || 0) + (a.upload || 0);
        const sb = (b.download || 0) + (b.upload || 0);
        return sb - sa;
      }
      if (sortBy === "time") {
        return new Date(b.start).getTime() - new Date(a.start).getTime();
      }
      const speedA = connectionSpeeds[a.id];
      const speedB = connectionSpeeds[b.id];
      const sa = speedA ? speedA.down + speedA.up : 0;
      const sb = speedB ? speedB.down + speedB.up : 0;
      return sb - sa;
    });

    return list;
  }, [connectionSpeeds, rawConns, search, sortBy]);

  return (
    <div className="space-y-4">
      {/* 头部状态与操作 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Cable className="h-4.5 w-4.5 text-primary" />
            活动连接监控
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            当前活跃会话: {rawConns.length} 个 · 实时监视目标主机、分流规则与链路
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={closeAll}
            disabled={rawConns.length === 0}
          >
            <XCircle className="h-4 w-4" />
            断开全部连接
          </Button>
        </div>
      </div>

      {/* 搜索与排序 */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索目标/来源地址、进程名或命中规则…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>
        <div className="w-48">
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="h-9 text-xs"
          >
            <option value="speed">按实时速度降序</option>
            <option value="time">按开始时间降序</option>
          </Select>
        </div>
      </div>

      {/* 连接表格 */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>目标地址</TableHead>
            <TableHead className="w-36">来源地址</TableHead>
            <TableHead className="w-24">协议/网络</TableHead>
            <TableHead className="w-36">分流规则</TableHead>
            <TableHead>代理链路</TableHead>
            <TableHead className="w-32">传输速度</TableHead>
            <TableHead className="w-16 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((conn) => {
            const host = conn.metadata?.host || conn.metadata?.destinationIP;
            const sourceIP = conn.metadata?.sourceIP || "未知";
            const destinationPort = conn.metadata?.destinationPort || "未知";
            const sourcePort = conn.metadata?.sourcePort || "未知";
            const network = conn.metadata?.network || "未知";
            const protocol = conn.metadata?.type || "未知";
            // Mihomo 返回的 Chains 从实际节点向上回溯到入口策略组；界面按实际出站方向展示。
            const chainItems = (conn.chains || []).filter(Boolean).reverse();
            const chain = chainItems.join(" → ") || "直连";
            const proxyNode = chainItems[chainItems.length - 1] || "直连";
            const speed = connectionSpeeds[conn.id] ?? { up: 0, down: 0 };
            return (
              <TableRow key={conn.id}>
                <TableCell>
                  <div className="font-semibold text-xs text-foreground/90 max-w-[260px] truncate" title={host}>
                    {host || "未知"}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">端口: {destinationPort}</div>
                </TableCell>
                <TableCell>
                  <div className="max-w-[150px] truncate font-mono text-xs text-foreground/90" title={sourceIP}>
                    {sourceIP}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">端口: {sourcePort}</div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1 font-mono uppercase">
                    <div className="text-xs font-medium text-foreground/90">{network}</div>
                    <div className="text-[10px] text-muted-foreground">{protocol}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-xs font-medium text-foreground/85 truncate max-w-[130px]" title={conn.rule}>
                    {conn.rule || "Direct"}
                  </div>
                  {conn.rulePayload && (
                    <div className="text-[10px] text-muted-foreground truncate max-w-[130px]">
                      {conn.rulePayload}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="max-w-[220px]">
                    <div className="truncate text-xs font-medium text-foreground/90" title={proxyNode}>
                      {proxyNode}
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={chain}>
                      {chain}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <div className="space-y-0.5 font-mono text-xs leading-4">
                    <div className="flex items-center gap-1 whitespace-nowrap text-emerald-500">
                      <ArrowDown className="h-3 w-3 shrink-0" />
                      {formatSpeed(speed.down)}
                    </div>
                    <div className="flex items-center gap-1 whitespace-nowrap text-sky-500">
                      <ArrowUp className="h-3 w-3 shrink-0" />
                      {formatSpeed(speed.up)}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="iconSm"
                    onClick={() => closeOne(conn.id)}
                    title="断开此连接"
                  >
                    <XCircle className="h-3.5 w-3.5 text-rose-500 hover:text-rose-600" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {filtered.length === 0 && (
        <div className="text-center py-12 bg-card/30 rounded-2xl border border-dashed border-border/70">
          <Cable className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
          <h4 className="text-sm font-semibold text-foreground">暂无活跃网络连接</h4>
          <p className="text-xs text-muted-foreground mt-1">
            当系统产生网络请求时将在此实时呈现会话详情
          </p>
        </div>
      )}
    </div>
  );
}
