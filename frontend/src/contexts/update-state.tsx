import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type MetaInfo, type UpdateCheck, type UpdateStatus } from "@/lib/api";

const AUTO_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

interface UpdateState {
  checkResult?: UpdateCheck;
  checking: boolean;
  task?: UpdateStatus;
  dialogOpen: boolean;
  hasUpdate: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  checkNow: () => Promise<UpdateCheck | undefined>;
  startUpdate: () => void;
  restartApplication: () => void;
  starting: boolean;
  restarting: boolean;
}

const UpdateContext = createContext<UpdateState | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const check = useQuery({
    queryKey: ["updateCheck"],
    queryFn: () => api.get<UpdateCheck>("/api/update/check"),
    retry: false,
    staleTime: 60 * 60 * 1000,
    refetchInterval: AUTO_CHECK_INTERVAL,
  });
  const status = useQuery({
    queryKey: ["updateStatus"],
    queryFn: () => api.get<UpdateStatus>("/api/update/status"),
    retry: false,
    refetchInterval: (query) => (query.state.data?.running ? 1_000 : 5_000),
  });

  const start = useMutation({
    mutationFn: () => api.post("/api/update/apply"),
    onSuccess: () => {
      toast.success("更新下载已开始");
      qc.invalidateQueries({ queryKey: ["updateStatus"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "启动更新失败"),
  });

  const restart = useMutation({
    mutationFn: () => api.post("/api/update/restart"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["updateStatus"] }),
    onError: (error: any) => toast.error(error?.message ?? "重启应用失败"),
  });

  useEffect(() => {
    if (status.data?.state !== "restarting") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await api.get<MetaInfo>("/api/meta");
        if (!cancelled) location.reload();
        return;
      } catch {
        if (!cancelled) timer = setTimeout(poll, 1_500);
      }
    };
    timer = setTimeout(poll, 2_500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status.data?.state]);

  const checkNow = async () => {
    const result = await check.refetch();
    return result.data;
  };

  const openDialog = () => {
    setDialogOpen(true);
    if (!check.data || check.data.error) void check.refetch();
  };

  return (
    <UpdateContext.Provider
      value={{
        checkResult: check.data,
        checking: check.isFetching,
        task: status.data,
        dialogOpen,
        hasUpdate: check.data?.error ? false : (check.data?.has_update ?? false),
        openDialog,
        closeDialog: () => setDialogOpen(false),
        checkNow,
        startUpdate: () => start.mutate(),
        restartApplication: () => restart.mutate(),
        starting: start.isPending,
        restarting: restart.isPending,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  const value = useContext(UpdateContext);
  if (!value) throw new Error("useUpdate must be used within UpdateProvider");
  return value;
}
