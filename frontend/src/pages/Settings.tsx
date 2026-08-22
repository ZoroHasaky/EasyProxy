import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload, Moon, Sun } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));

  const changePw = useMutation({
    mutationFn: () => api.post("/api/password", { old_password: oldPw, new_password: newPw }),
    onSuccess: () => {
      toast.success("密码已修改");
      setOldPw(""); setNewPw(""); setConfirmPw("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const restore = async (file: File) => {
    if (!confirm("恢复备份将覆盖当前全部数据（保留当前登录密码），确定？")) return;
    setRestoring(true);
    try {
      await api.upload("/api/backup/restore", file);
      toast.success("备份已恢复");
      setTimeout(() => location.reload(), 1500);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRestoring(false);
    }
  };

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("easyproxy-theme", next ? "dark" : "light");
  };

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">设置</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">修改密码</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>当前密码</Label>
              <Input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>新密码（≥8位）</Label>
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>确认新密码</Label>
              <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
            </div>
          </div>
          <Button
            onClick={() => {
              if (newPw.length < 8) return toast.error("新密码至少 8 位");
              if (newPw !== confirmPw) return toast.error("两次输入不一致");
              changePw.mutate();
            }}
            disabled={changePw.isPending || !oldPw || !newPw}
          >
            {changePw.isPending ? "提交中…" : "修改密码"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">外观</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={toggleTheme}>
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {dark ? "切换到浅色" : "切换到深色"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">数据备份</CardTitle>
          <CardDescription>导出/导入全部配置数据（订阅、节点、规则、设置；不含密码）</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => { window.location.href = "/api/backup"; }}>
            <Download className="h-4 w-4" /> 导出备份
          </Button>
          <div>
            <input
              type="file"
              accept="application/json"
              className="text-sm"
              disabled={restoring}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) restore(f);
                e.target.value = "";
              }}
            />
            {restoring && <span className="ml-2 text-xs text-muted-foreground">恢复中…</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
