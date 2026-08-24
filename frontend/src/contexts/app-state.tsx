import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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

interface MihomoRuntimeState {
  traffic: { up: number; down: number };
  connectionCount: number;
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

export function MihomoRuntimeProvider({ children }: { children: ReactNode }) {
  const [traffic, setTraffic] = useState<{ up: number; down: number }>({
    up: 0,
    down: 0,
  });
  const [connectionCount, setConnectionCount] = useState(0);
  const [connectionsConnected, setConnectionsConnected] = useState(false);
  const [mode, setMode] = useState<MihomoMode>("rule");
  const [modePending, setModePending] = useState(false);
  const trafficSampleRef = useRef<{ up: number; down: number; at: number } | null>(null);

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
    return openStream<{
      connections?: Array<unknown> | null;
      uploadTotal?: number;
      downloadTotal?: number;
    }>(
      "/api/mihomo/connections",
      (data) => {
        const count = Array.isArray(data.connections) ? data.connections.length : 0;
        const up = Math.max(0, Number(data.uploadTotal) || 0);
        const down = Math.max(0, Number(data.downloadTotal) || 0);
        const now = Date.now();
        const previous = trafficSampleRef.current;

        setConnectionCount(count);
        if (previous) {
          const elapsedSeconds = Math.max((now - previous.at) / 1000, 0.001);
          setTraffic({
            up: Math.max(0, (up - previous.up) / elapsedSeconds),
            down: Math.max(0, (down - previous.down) / elapsedSeconds),
          });
        }
        trafficSampleRef.current = { up, down, at: now };
      },
      (connected) => {
        setConnectionsConnected(connected);
        if (!connected) {
          setConnectionCount(0);
          setTraffic({ up: 0, down: 0 });
          trafficSampleRef.current = null;
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
      connectionCount,
      connectionsConnected,
      mode,
      modePending,
      switchMode,
    }),
    [
      traffic,
      connectionCount,
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
