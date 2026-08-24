import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Layout } from "@/components/layout";
import LoginPage from "@/pages/Login";
import ChangePasswordPage from "@/pages/ChangePassword";
import DashboardPage from "@/pages/Dashboard";
import NodesPage from "@/pages/Nodes";
import RulesPage from "@/pages/Rules";
import ConnectionsPage from "@/pages/Connections";
import KernelPage from "@/pages/Kernel";
import TransparentProxyPage from "@/pages/TransparentProxy";
import LogsPage from "@/pages/Logs";
import SettingsPage from "@/pages/Settings";
import AboutPage from "@/pages/About";
import { MihomoRuntimeProvider } from "@/contexts/app-state";

function Me() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api.get<{ authenticated: boolean; must_change_password: boolean }>(
        "/api/me",
      ),
    retry: false,
    refetchInterval: 30_000,
  });

  if (me.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        EasyProxy 加载中…
      </div>
    );
  }
  if (me.isError || !me.data?.authenticated) {
    return <LoginPage onDone={() => me.refetch()} />;
  }
  if (me.data.must_change_password) {
    return <ChangePasswordPage onDone={() => me.refetch()} />;
  }
  return (
    <MihomoRuntimeProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route
            path="/subscriptions"
            element={<Navigate to="/nodes?tab=subscriptions" replace />}
          />
          <Route path="/nodes" element={<NodesPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route
            path="/groups"
            element={<Navigate to="/rules?tab=groups" replace />}
          />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/kernel" element={<KernelPage />} />
          <Route path="/tun" element={<TransparentProxyPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </MihomoRuntimeProvider>
  );
}

export default function App() {
  const [fatal, setFatal] = useState<string>("");
  useEffect(() => {
    api.get("/api/meta").catch((e) => {
      if (e instanceof ApiError && e.status === 0) setFatal("无法连接后端服务");
    });
  }, []);
  if (fatal) {
    return (
      <div className="flex h-screen items-center justify-center text-destructive">
        {fatal}
      </div>
    );
  }
  return <Me />;
}
