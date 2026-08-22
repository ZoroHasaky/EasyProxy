import { useState } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ChangePasswordPage({ onDone }: { onDone: () => void }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 8) {
      toast.error("新密码至少 8 位");
      return;
    }
    if (newPw !== confirm) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/password", { old_password: oldPw, new_password: newPw });
      toast.success("密码已修改，进入面板");
      onDone();
    } catch (err: any) {
      toast.error(err.message ?? "修改失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-600 text-white">
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle className="text-xl">首次登录，请修改密码</CardTitle>
          <CardDescription>出于安全考虑，初始密码必须修改后才能使用面板</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>初始密码</Label>
              <Input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>新密码（至少 8 位）</Label>
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>确认新密码</Label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "提交中…" : "修改密码"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
