import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ConfigApplyResult, PendingConfigResponse } from "@/lib/api";

interface ConfigApplyContextState {
  pending?: PendingConfigResponse;
  isLoading: boolean;
  isApplying: boolean;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  apply: () => Promise<void>;
}

const ConfigApplyContext = createContext<ConfigApplyContextState | null>(null);

function applyResultMessage(result: ConfigApplyResult["result"]) {
  switch (result) {
    case "reloaded":
      return "待应用配置已热重载生效";
    case "restarted":
      return "待应用配置已重启内核生效";
    case "started":
      return "待应用配置已启动内核生效";
    default:
      return "配置已保存，内核安装后会自动生效";
  }
}

export function ConfigApplyProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const pending = useQuery({
    queryKey: ["config-pending"],
    queryFn: () => api.get<PendingConfigResponse>("/api/config/pending"),
    refetchInterval: 10_000,
  });
  const applyMutation = useMutation({
    mutationFn: () => api.post<ConfigApplyResult>("/api/config/apply"),
    onSuccess: (result) => {
      toast.success(applyResultMessage(result.result));
      qc.invalidateQueries({ queryKey: ["config-pending"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["core"] });
      qc.invalidateQueries({ queryKey: ["meta"] });
      qc.invalidateQueries({ queryKey: ["geo-status"] });
    },
    onError: (error: any) => toast.error(`应用配置失败：${error.message}`),
  });
  const value = useMemo<ConfigApplyContextState>(() => ({
    pending: pending.data,
    isLoading: pending.isLoading,
    isApplying: applyMutation.isPending,
    dialogOpen,
    setDialogOpen,
    refresh: async () => { await pending.refetch(); },
    apply: async () => { await applyMutation.mutateAsync(); },
  }), [pending.data, pending.isLoading, applyMutation.isPending, dialogOpen]);
  return <ConfigApplyContext.Provider value={value}>{children}</ConfigApplyContext.Provider>;
}

export function useConfigApply() {
  const context = useContext(ConfigApplyContext);
  if (!context) throw new Error("useConfigApply must be used within ConfigApplyProvider");
  return context;
}
