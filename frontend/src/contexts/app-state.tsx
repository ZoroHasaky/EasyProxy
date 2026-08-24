import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { api, mihomo } from "@/lib/api";
import { openStream } from "@/lib/ws";

type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function initialTheme(): Theme {
  return localStorage.getItem("easyproxy-theme") === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("easyproxy-theme", theme);
  }, [theme]);

  const value = useMemo<ThemeState>(
    () => ({
      theme,
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}

export type MihomoMode = "rule" | "global" | "direct";

export interface TrafficPoint {
  t: string;
  up: number;
  down: number;
}

interface MihomoRuntimeState {
  traffic: { up: number; down: number };
  trafficHistory: TrafficPoint[];
  trafficConnected: boolean;
  mode: MihomoMode;
  modePending: boolean;
  switchMode: (mode: MihomoMode) => Promise<void>;
}

const MihomoRuntimeContext = createContext<MihomoRuntimeState | null>(null);

const MODE_LABELS: Record<MihomoMode, string> = {
  rule: "规则",
  global: "全局",
  direct: "直连",
};

function isMihomoMode(value: string): value is MihomoMode {
  return value === "rule" || value === "global" || value === "direct";
}

export function MihomoRuntimeProvider({ children }: { children: ReactNode }) {
  const [traffic, setTraffic] = useState({ up: 0, down: 0 });
  const [trafficHistory, setTrafficHistory] = useState<TrafficPoint[]>([]);
  const [trafficConnected, setTrafficConnected] = useState(false);
  const [mode, setMode] = useState<MihomoMode>("rule");
  const [modePending, setModePending] = useState(false);

  useEffect(() => {
    return openStream(
      "/api/ws/traffic",
      (data) => {
        try {
          const payload = JSON.parse(data);
          const next = {
            up: Number(payload.up) || 0,
            down: Number(payload.down) || 0,
          };
          setTraffic(next);
          setTrafficHistory((history) =>
            [
              ...history,
              {
                t: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
                ...next,
              },
            ].slice(-60),
          );
        } catch {
          // 忽略单条异常推送，等待下一条有效数据。
        }
      },
      setTrafficConnected,
    );
  }, []);

  useEffect(() => {
    api
      .get<{ mode?: string }>("/api/mihomo/configs")
      .then((config) => {
        if (config.mode && isMihomoMode(config.mode)) setMode(config.mode);
      })
      .catch(() => {});
  }, []);

  const switchMode = async (nextMode: MihomoMode) => {
    if (modePending || nextMode === mode) return;
    const previousMode = mode;
    setMode(nextMode);
    setModePending(true);
    try {
      await mihomo.patchMode(nextMode);
      toast.success(`已切换到${MODE_LABELS[nextMode]}模式`);
    } catch (error: any) {
      setMode(previousMode);
      toast.error(error?.message ?? "切换运行模式失败");
    } finally {
      setModePending(false);
    }
  };

  const value = useMemo<MihomoRuntimeState>(
    () => ({
      traffic,
      trafficHistory,
      trafficConnected,
      mode,
      modePending,
      switchMode,
    }),
    [traffic, trafficHistory, trafficConnected, mode, modePending],
  );

  return <MihomoRuntimeContext.Provider value={value}>{children}</MihomoRuntimeContext.Provider>;
}

export function useMihomoRuntime() {
  const value = useContext(MihomoRuntimeContext);
  if (!value) throw new Error("useMihomoRuntime must be used within MihomoRuntimeProvider");
  return value;
}
