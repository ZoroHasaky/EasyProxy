// WebSocket 订阅（自动重连）
export function openStream(
  path: string,
  onMessage: (data: string) => void,
  onStatus?: (open: boolean) => void,
): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}${path}`);
    ws.onopen = () => onStatus?.(true);
    ws.onmessage = (ev) => onMessage(ev.data as string);
    ws.onclose = () => {
      onStatus?.(false);
      if (!closed) {
        retryTimer = setTimeout(connect, 2000);
      }
    };
    ws.onerror = () => ws?.close();
  };
  connect();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    ws?.close();
  };
}

export interface TrafficPoint {
  up: number;
  down: number;
}
