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

export type Theme = "dark" | "light" | "system";
type ResolvedTheme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function initialTheme(): Theme {
  const saved = localStorage.getItem("easyproxy-theme");
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? "dark" : "light");
    setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
    localStorage.setItem("easyproxy-theme", theme);
  }, [resolvedTheme, theme]);

  const value = useMemo<ThemeState>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
    }),
    [resolvedTheme, theme],
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
  connectionCount: number;
  trafficTotals: { up: number; down: number };
  connectionsConnected: boolean;
  mode: MihomoMode;
  modePending: boolean;
  switchMode: (mode: MihomoMode) => Promise<void>;
}

const MihomoRuntimeContext = createContext<MihomoRuntimeState | null>(null);

const MODE_LABELS: Record<MihomoMode, string> = {
  rule: "规则模式",
  global: "全局模式",
  direct: "直连模式",
};

function isMihomoMode(value: string): value is MihomoMode {
  return value === "rule" || value === "global" || value === "direct";
}

const MAX_HISTORY = 40;

export function MihomoRuntimeProvider({ children }: { children: ReactNode }) {
  const [traffic, setTraffic] = useState<{ up: number; down: number }>({
    up: 0,
    down: 0,
  });
  const [trafficHistory, setTrafficHistory] = useState<TrafficPoint[]>(() =>
    Array.from({ length: 20 }, (_, i) => ({
      t: `${i}s`,
      up: 0,
      down: 0,
    }))
  );
  const [trafficConnected, setTrafficConnected] = useState(false);
  const [connectionCount, setConnectionCount] = useState(0);
  const [trafficTotals, setTrafficTotals] = useState<{ up: number; down: number }>({
    up: 0,
    down: 0,
  });
  const [connectionsConnected, setConnectionsConnected] = useState(false);
  const [mode, setMode] = useState<MihomoMode>("rule");
  const [modePending, setModePending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const pullMode = async () => {
      try {
        const config = await api.get<{ mode?: string }>("/api/mihomo/configs");
        if (cancelled) return;
        const nextMode = config.mode?.toLowerCase() ?? "";
        if (isMihomoMode(nextMode)) {
          setMode(nextMode);
        }
      } catch {
        /* 内核可能未启动 */
      }
    };

    pullMode();
    const interval = setInterval(pullMode, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    return openStream<{ up: number; down: number }>(
      "/api/mihomo/traffic",
      (data) => {
        const up = Math.max(0, Number(data.up) || 0);
        const down = Math.max(0, Number(data.down) || 0);
        const t = new Date().toLocaleTimeString("zh-CN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        setTraffic({ up, down });
        setTrafficHistory((prev) => {
          const next = [...prev, { t, up, down }];
          if (next.length > MAX_HISTORY) {
            return next.slice(next.length - MAX_HISTORY);
          }
          return next;
        });
      },
      (connected) => {
        setTrafficConnected(connected);
        if (!connected) {
          setTraffic({ up: 0, down: 0 });
        }
      },
    );
  }, []);

  useEffect(() => {
    return openStream<{
      connections?: Array<unknown> | null;
      uploadTotal?: number;
      downloadTotal?: number;
    }>(
      "/api/mihomo/connections",
      (data) => {
        const count = Array.isArray(data.connections) ? data.connections.length : 0;
        setConnectionCount(count);
        setTrafficTotals({
          up: Number(data.uploadTotal) || 0,
          down: Number(data.downloadTotal) || 0,
        });
      },
      (connected) => {
        setConnectionsConnected(connected);
        if (!connected) {
          setConnectionCount(0);
        }
      },
    );
  }, []);

  const switchMode = async (nextMode: MihomoMode) => {
    if (nextMode === mode || modePending) return;
    const prev = mode;
    setMode(nextMode);
    setModePending(true);
    try {
      await mihomo.patchMode(nextMode);
      toast.success(`运行模式已切换为「${MODE_LABELS[nextMode]}」`);
    } catch (e: any) {
      setMode(prev);
      toast.error(`切换模式失败: ${e.message}`);
    } finally {
      setModePending(false);
    }
  };

  const value = useMemo<MihomoRuntimeState>(
    () => ({
      traffic,
      trafficHistory,
      trafficConnected,
      connectionCount,
      trafficTotals,
      connectionsConnected,
      mode,
      modePending,
      switchMode,
    }),
    [
      traffic,
      trafficHistory,
      trafficConnected,
      connectionCount,
      trafficTotals,
      connectionsConnected,
      mode,
      modePending,
    ],
  );

  return (
    <MihomoRuntimeContext.Provider value={value}>
      {children}
    </MihomoRuntimeContext.Provider>
  );
}

export function useMihomoRuntime() {
  const value = useContext(MihomoRuntimeContext);
  if (!value) {
    throw new Error("useMihomoRuntime must be used within MihomoRuntimeProvider");
  }
  return value;
}
