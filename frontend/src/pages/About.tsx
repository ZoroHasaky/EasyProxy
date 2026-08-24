import { useQuery } from "@tanstack/react-query";
import {
  Info,
  Github,
  Sparkles,
  Heart,
  Cpu,
  Layers,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { api, MetaInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useUpdate } from "@/contexts/update-state";

export default function AboutPage() {
  const { setDialogOpen, checkData } = useUpdate();
  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: () => api.get<MetaInfo>("/api/meta"),
  });

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* 头部关于横幅 */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-primary/15 via-indigo-500/10 to-purple-500/15 p-8 border border-primary/20 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white shadow-xl shadow-primary/30">
              <Zap className="h-8 w-8 fill-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight text-foreground">
                EasyProxy
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                现代化节点聚合 · 可视化分流规则 · Mihomo 内核面板
              </p>
            </div>
          </div>

          <Button
            variant="gradient"
            onClick={() => setDialogOpen(true)}
            className="shrink-0"
          >
            <Sparkles className="h-4 w-4" />
            检查系统更新
          </Button>
        </div>
      </div>

      {/* 系统组件与环境信息 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" />
              <CardTitle className="text-base font-bold">Mihomo 代理内核</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">内核版本:</span>
              <span className="font-mono font-semibold">{meta.data?.core?.version || "未知"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">运行状态:</span>
              <Badge variant={meta.data?.core?.state === "running" ? "success" : "destructive"}>
                {meta.data?.core?.state === "running" ? "运行正常" : "异常"}
              </Badge>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-muted-foreground">进程 PID:</span>
              <span className="font-mono">{meta.data?.core?.pid || "-"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-indigo-500" />
              <CardTitle className="text-base font-bold">前端与系统面板</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">面板版本:</span>
              <span className="font-mono font-semibold">{meta.data?.version || "v0.1.0"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">架构风格:</span>
              <span className="font-medium">React 18 + Vite + Tailwind + GlassUI</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-muted-foreground">最新可用版:</span>
              <span className="font-mono text-primary font-semibold">
                {checkData?.latest || "最新"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 项目开源信息与致谢 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">开源与致谢</CardTitle>
          <CardDescription>
            EasyProxy 遵循 MIT 开源协议构建，感谢以下开源项目的卓越贡献
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-xs text-muted-foreground leading-relaxed">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="font-bold text-foreground">Mihomo</div>
              <div className="text-[11px] mt-0.5">Clash.Meta 内核核心</div>
            </div>
            <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="font-bold text-foreground">React + Vite</div>
              <div className="text-[11px] mt-0.5">现代化前端响应式架构</div>
            </div>
            <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="font-bold text-foreground">Tailwind CSS</div>
              <div className="text-[11px] mt-0.5">现代化原子美学设计</div>
            </div>
            <div className="p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="font-bold text-foreground">Go + SQLite</div>
              <div className="text-[11px] mt-0.5">轻量高并发后端引擎</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
