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
import { defineMessages, useMessages } from "@/contexts/language";

const messages = defineMessages({
  reloaded: "待应用配置已热重载生效",
  restarted: "待应用配置已重启内核生效",
  started: "待应用配置已启动内核生效",
  saved: "配置已保存，内核安装后会自动生效",
  failed: "应用配置失败",
}, {
  reloaded: "Pending changes applied by hot reload",
  restarted: "Pending changes applied after restarting the kernel",
  started: "Pending changes applied after starting the kernel",
  saved: "Configuration saved and will apply after the kernel is installed",
  failed: "Failed to apply configuration",
});

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

function applyResultMessage(result: ConfigApplyResult["result"], text: (typeof messages)["zh-CN"] | (typeof messages)["en"]) {
  switch (result) {
    case "reloaded":
      return text.reloaded;
    case "restarted":
      return text.restarted;
    case "started":
      return text.started;
    default:
      return text.saved;
  }
}

export function ConfigApplyProvider({ children }: { children: ReactNode }) {
  const text = useMessages(messages);
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
      toast.success(applyResultMessage(result.result, text));
      qc.invalidateQueries({ queryKey: ["config-pending"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["core"] });
      qc.invalidateQueries({ queryKey: ["meta"] });
      qc.invalidateQueries({ queryKey: ["geo-status"] });
    },
    onError: (error: any) => toast.error(`${text.failed}: ${error.message}`),
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
