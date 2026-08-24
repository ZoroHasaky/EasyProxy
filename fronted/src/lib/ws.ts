// WebSocket 客户端管理与自动重连封装

export function openStream<T>(
  path: string,
  onMessage: (data: T) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  let ws: WebSocket | null = null;
  let timer: any = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}${path}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      onStatus?.(true);
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        onMessage(data);
      } catch {
        /* 忽略无效帧 */
      }
    };

    ws.onerror = () => {
      ws?.close();
    };

    ws.onclose = () => {
      onStatus?.(false);
      if (!closed) {
        timer = setTimeout(connect, 2000);
      }
    };
  };

  connect();

  return () => {
    closed = true;
    clearTimeout(timer);
    if (ws) {
      ws.close();
      ws = null;
    }
  };
}
