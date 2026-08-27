import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, UpdateCheck, UpdateStatus } from "@/lib/api";
import { defineMessages, useMessages } from "@/contexts/language";

const messages = defineMessages({
  started: "已开始更新 EasyProxy…",
  startFailed: "更新启动失败",
  restarting: "更新已准备完成，正在重启 EasyProxy…",
  restartFailed: "重启更新失败",
  completed: "更新已完成，面板正在重新加载…",
}, {
  started: "EasyProxy update started…",
  startFailed: "Failed to start the update",
  restarting: "Update is ready. Restarting EasyProxy…",
  restartFailed: "Failed to restart after the update",
  completed: "Update completed. Reloading the panel…",
});

interface UpdateContextState {
  checkData?: UpdateCheck;
  isChecking: boolean;
  checkError?: Error | null;
  status?: UpdateStatus;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  checkForUpdates: () => Promise<void>;
  startUpdate: () => Promise<void>;
  restartUpdate: () => Promise<void>;
  isUpdating: boolean;
  isRestarting: boolean;
}

const UpdateContext = createContext<UpdateContextState | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const text = useMessages(messages);
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const check = useQuery({
    queryKey: ["updateCheck"],
    queryFn: () => api.get<UpdateCheck>("/api/update/check"),
    refetchInterval: 300_000,
    retry: false,
  });

  const status = useQuery({
    queryKey: ["updateStatus"],
    queryFn: () => api.get<UpdateStatus>("/api/update/status"),
    refetchInterval: (q) => (q.state.data?.running ? 1000 : false),
  });

  const doUpdate = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/update/apply"),
    onSuccess: () => {
      toast.info(text.started);
      qc.invalidateQueries({ queryKey: ["updateStatus"] });
    },
    onError: (e: any) => toast.error(`${text.startFailed}: ${e.message}`),
  });

  const restart = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/update/restart"),
    onSuccess: () => {
      toast.info(text.restarting);
      qc.invalidateQueries({ queryKey: ["updateStatus"] });
    },
    onError: (e: any) => toast.error(`${text.restartFailed}: ${e.message}`),
  });

  useEffect(() => {
    if (status.data?.state === "restarting") {
      toast.success(text.completed);
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    }
  }, [status.data?.state, text.completed]);

  const value = useMemo<UpdateContextState>(
    () => ({
      checkData: check.data,
      isChecking: check.isFetching,
      checkError: check.error as Error | null,
      status: status.data,
      dialogOpen,
      setDialogOpen,
      checkForUpdates: async () => {
        await check.refetch();
      },
      startUpdate: async () => {
        await doUpdate.mutateAsync();
      },
      restartUpdate: async () => {
        await restart.mutateAsync();
      },
      isUpdating: status.data?.running || doUpdate.isPending || restart.isPending,
      isRestarting: restart.isPending,
    }),
    [
      check.data,
      check.isFetching,
      check.error,
      status.data,
      dialogOpen,
      doUpdate.isPending,
      restart.isPending,
    ],
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdate() {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error("useUpdate must be used within UpdateProvider");
  return ctx;
}
