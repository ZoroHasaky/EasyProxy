import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, KeyRound, Lock, Server, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, MetaInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function formatTime(value?: string) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未记录" : date.toLocaleString("zh-CN", { hour12: false });
}

export default function SettingsPage() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const metaQuery = useQuery({
    queryKey: ["meta"],
    queryFn: () => api.get<MetaInfo>("/api/meta"),
    refetchInterval: 30_000,
  });
  const passwordMutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/password", { old_password: oldPassword, new_password: newPassword }),
    onSuccess: () => {
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("管理密码已修改");
    },
    onError: (error: any) => toast.error(error.message),
  });

  const submitPassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    passwordMutation.mutate();
  };

  const meta = metaQuery.data;
  const system = meta?.system;
  const version = meta?.version ? (meta.version.startsWith("v") ? meta.version : `v${meta.version}`) : "读取中…";
  const details = [
    { label: "版本", value: version, hint: system?.build_type || "" },
    { label: "提交", value: system?.commit || "未嵌入", mono: true },
    { label: "构建时间", value: formatTime(system?.build_time) },
    { label: "更新仓库", value: system?.release_repo || "zorohasaky/easyproxy", mono: true },
    { label: "部署方式", value: system?.deployment || "读取中…" },
    { label: "Go 版本", value: system?.go_version || "读取中…", mono: true },
    { label: "系统 / 架构", value: system?.architecture || "读取中…", mono: true },
    { label: "服务时区", value: system?.timezone || "读取中…", mono: true },
  ];

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-r from-primary/15 via-indigo-500/10 to-purple-500/15 p-6 shadow-sm sm:p-8">
        <div className="relative z-10 flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-xl shadow-primary/30">
            <Server className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight text-foreground">系统信息</h2>
            <p className="mt-1 text-xs text-muted-foreground">当前 EasyProxy 服务的构建与运行环境</p>
          </div>
        </div>

        <div className="relative z-10 mt-6 grid grid-cols-1 gap-x-10 gap-y-5 border-t border-primary/15 pt-5 sm:grid-cols-2 lg:grid-cols-3">
          {details.map((item) => (
            <div key={item.label} className="min-w-0">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className={`mt-1 truncate text-sm font-semibold text-foreground ${item.mono ? "font-mono" : ""}`} title={item.value}>
                {item.value}
              </div>
              {item.hint && <div className="mt-1 inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{item.hint}</div>}
            </div>
          ))}
        </div>
      </section>

      <Card className="border-border/80">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2 text-primary"><KeyRound className="h-4.5 w-4.5" /></div>
            <div>
              <CardTitle className="text-base font-bold">修改管理密码</CardTitle>
              <CardDescription>新密码至少 8 位；修改后会立即生效。</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submitPassword}>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="current-password">当前密码</Label>
                <Input id="current-password" type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password">新密码</Label>
                <Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">确认新密码</Label>
                <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />密码仅以加密摘要形式保存</div>
              <Button type="submit" size="sm" disabled={passwordMutation.isPending || !oldPassword || !newPassword || !confirmPassword}>
                {passwordMutation.isPending ? <Clock className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                {passwordMutation.isPending ? "修改中…" : "确认修改"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
