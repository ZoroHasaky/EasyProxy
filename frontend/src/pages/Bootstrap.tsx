import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defineMessages, useMessages } from "@/contexts/language";

const messages = defineMessages({
  title: "首次设置管理员密码",
  description: "桌面版首次启动需要先设置管理员密码，密码至少 8 位。",
  password: "管理员密码",
  confirm: "确认密码",
  placeholder: "请输入至少 8 位密码",
  confirmPlaceholder: "再次输入密码",
  mismatch: "两次输入的密码不一致",
  tooShort: "密码至少 8 位",
  saving: "保存中…",
  submit: "完成设置",
  security: "密码只会以加密摘要形式保存",
}, {
  title: "Set Administrator Password",
  description: "Set an administrator password before using the desktop client. It must contain at least 8 characters.",
  password: "Administrator password",
  confirm: "Confirm password",
  placeholder: "Enter at least 8 characters",
  confirmPlaceholder: "Enter the password again",
  mismatch: "The passwords do not match",
  tooShort: "The password must be at least 8 characters",
  saving: "Saving…",
  submit: "Finish setup",
  security: "Only an encrypted password hash is stored",
});

export default function BootstrapPage({ onDone }: { onDone: () => void }) {
  const text = useMessages(messages);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/bootstrap", { password }),
    onSuccess: onDone,
    onError: (error: any) => toast.error(error.message),
  });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error(text.tooShort);
      return;
    }
    if (password !== confirm) {
      toast.error(text.mismatch);
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md border-border/70 shadow-xl">
        <CardHeader className="space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Lock className="h-5 w-5" />
          </div>
          <CardTitle>{text.title}</CardTitle>
          <CardDescription>{text.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="bootstrap-password">{text.password}</Label>
              <Input id="bootstrap-password" type="password" autoComplete="new-password" placeholder={text.placeholder} value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bootstrap-confirm">{text.confirm}</Label>
              <Input id="bootstrap-confirm" type="password" autoComplete="new-password" placeholder={text.confirmPlaceholder} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              {text.security}
            </div>
            <Button type="submit" className="w-full" disabled={mutation.isPending || !password || !confirm}>
              {mutation.isPending ? text.saving : text.submit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
