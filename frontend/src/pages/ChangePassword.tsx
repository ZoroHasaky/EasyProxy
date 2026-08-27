import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LanguageToggle } from "@/components/language-toggle";
import { defineMessages, useMessages } from "@/contexts/language";

const messages = defineMessages({
  mismatch: "两次输入的新密码不一致",
  success: "密码修改成功！",
  failed: "修改失败",
  title: "必须修改初始密码",
  description: "为了系统安全，首次使用必须将临时随机密码替换为您专属的强密码",
  current: "当前初始密码",
  currentPlaceholder: "输入当前使用的临时密码",
  newPassword: "新密码",
  newPlaceholder: "输入新密码",
  confirm: "确认新密码",
  confirmPlaceholder: "再次输入新密码",
  submitting: "提交中…",
  submit: "确认修改并进入面板",
}, {
  mismatch: "The new passwords do not match",
  success: "Password changed successfully!",
  failed: "Password change failed",
  title: "Change the Initial Password",
  description: "For security, replace the temporary password with your own strong password before continuing",
  current: "Current temporary password",
  currentPlaceholder: "Enter the current temporary password",
  newPassword: "New password",
  newPlaceholder: "Enter a new password",
  confirm: "Confirm new password",
  confirmPlaceholder: "Enter the new password again",
  submitting: "Submitting…",
  submit: "Change Password and Continue",
});

export default function ChangePasswordPage({ onDone }: { onDone: () => void }) {
  const text = useMessages(messages);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(text.mismatch);
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/password", {
        old_password: oldPassword,
        new_password: newPassword,
      });
      toast.success(text.success);
      onDone();
    } catch (e: any) {
      toast.error(`${text.failed}: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-background px-4 relative overflow-hidden">
      <LanguageToggle className="absolute right-4 top-4 z-20" />
      <Card className="w-full max-w-md border-border/80 bg-card/75 backdrop-blur-2xl shadow-2xl z-10">
        <CardHeader className="text-center pb-2 pt-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 mb-3">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">{text.title}</CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-1">
            {text.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8 pt-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">{text.current}</Label>
              <Input
                type="password"
                placeholder={text.currentPlaceholder}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{text.newPassword}</Label>
              <Input
                type="password"
                placeholder={text.newPlaceholder}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{text.confirm}</Label>
              <Input
                type="password"
                placeholder={text.confirmPlaceholder}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-sm font-bold mt-2"
              disabled={loading || !oldPassword || !newPassword || !confirmPassword}
            >
              {loading ? text.submitting : text.submit}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
