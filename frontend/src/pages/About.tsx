import { useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  Layers,
  Zap,
} from "lucide-react";
import { api, MetaInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
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

      {/* 前端与系统面板信息 */}
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
            <span className="font-mono font-semibold">
              {meta.data?.version ? (meta.data.version.startsWith("v") ? meta.data.version : `v${meta.data.version}`) : "—"}
            </span>
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
