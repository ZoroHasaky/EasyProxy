import { useState, useMemo } from "react";
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
import { Badge } from "@/components/ui/badge";
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
import { formatBytes, formatSpeed, formatDuration, cn } from "@/lib/utils";

export default function ConnectionsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"speed" | "time" | "traffic">("speed");

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

  const rawConns = connsQuery.data?.connections ?? [];

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
      const proc = (c.metadata?.process || "").toLowerCase();
      const rule = (c.rule || "").toLowerCase();
      const chain = (c.chains || []).join(" ").toLowerCase();
      return host.includes(kw) || dip.includes(kw) || proc.includes(kw) || rule.includes(kw) || chain.includes(kw);
    });

    list.sort((a, b) => {
      if (sortBy === "speed") {
        const sa = (a.download || 0) + (a.upload || 0);
        const sb = (b.download || 0) + (b.upload || 0);
        return sb - sa;
      }
      if (sortBy === "traffic") {
        const ta = (a.download || 0) + (a.upload || 0);
        const tb = (b.download || 0) + (b.upload || 0);
        return tb - ta;
      }
      return new Date(b.start).getTime() - new Date(a.start).getTime();
    });

    return list;
  }, [rawConns, search, sortBy]);

  return (
    <div className="space-y-4">
      {/* 头部状态与操作 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card/60 p-4 rounded-2xl border border-border/70 backdrop-blur-sm">
        <div>
          <h3 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
            <Cable className="h-4.5 w-4.5 text-primary" />
            活动连接监控 (Active Connections)
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
            placeholder="搜索目标 Host / IP / 进程名 / 命中规则…"
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
            <option value="time">按连接时长降序</option>
            <option value="traffic">按传输流量降序</option>
          </Select>
        </div>
      </div>

      {/* 连接表格 */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>目标地址 / 端口</TableHead>
            <TableHead className="w-24">协议/网络</TableHead>
            <TableHead className="w-36">分流规则</TableHead>
            <TableHead>代理链路 (Chains)</TableHead>
            <TableHead className="w-32">传输总量</TableHead>
            <TableHead className="w-28">连接时长</TableHead>
            <TableHead className="w-16 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((conn) => {
            const host = conn.metadata?.host || conn.metadata?.destinationIP;
            return (
              <TableRow key={conn.id}>
                <TableCell>
                  <div className="font-semibold text-xs text-foreground/90 max-w-[260px] truncate">
                    {host}:{conn.metadata?.destinationPort}
                  </div>
                  {conn.metadata?.process && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      进程: {conn.metadata.process}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px] font-mono uppercase">
                    {conn.metadata?.network}/{conn.metadata?.type}
                  </Badge>
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
                  <div className="text-xs font-mono text-primary font-medium truncate max-w-[200px]" title={(conn.chains || []).join(" -> ")}>
                    {(conn.chains || []).join(" → ")}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-xs font-mono">
                    <div className="text-emerald-500">↓ {formatBytes(conn.download)}</div>
                    <div className="text-sky-500">↑ {formatBytes(conn.upload)}</div>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {formatDuration(conn.start)}
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
