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
import GeoDataPage from "@/pages/GeoData";
import { MihomoRuntimeProvider } from "@/contexts/app-state";
import { UpdateProvider } from "@/contexts/update-state";
import { ConfigApplyProvider } from "@/contexts/config-apply-state";

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
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground font-mono text-sm">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          EasyProxy 正在加载…
        </div>
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
    <UpdateProvider>
      <ConfigApplyProvider>
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
            <Route path="/geo" element={<GeoDataPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </MihomoRuntimeProvider>
      </ConfigApplyProvider>
    </UpdateProvider>
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
      <div className="flex h-screen items-center justify-center text-destructive font-mono text-sm">
        {fatal}
      </div>
    );
  }
  return <Me />;
}
