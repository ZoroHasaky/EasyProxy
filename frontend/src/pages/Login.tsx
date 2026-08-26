import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Lock, ArrowRight, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function LoginPage({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    try {
      await api.post("/api/login", { password });
      toast.success("登录成功，欢迎使用 EasyProxy");
      onDone();
    } catch (e: any) {
      toast.error(`登录失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* 背景动态光晕 */}
      <div className="absolute top-1/4 -left-20 h-96 w-96 rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-20 h-96 w-96 rounded-full bg-indigo-500/20 blur-[120px] pointer-events-none" />

      <Card className="w-full max-w-md border-border/80 bg-card/75 backdrop-blur-2xl shadow-2xl z-10">
        <CardHeader className="text-center pb-2 pt-8">
          <img src="/easyproxy-logo.svg" alt="EasyProxy" className="mx-auto mb-3 h-14 w-14 rounded-2xl shadow-lg shadow-primary/30" />
          <CardTitle className="text-2xl font-black tracking-tight">EasyProxy</CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-1">
            即刻连接世界
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8 pt-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  autoFocus
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-sm font-bold shadow-md shadow-primary/25"
              disabled={loading || !password}
            >
              {loading ? "正在验证…" : "进入管理面板"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
