// 后端 API 客户端与类型定义

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => req<T>("GET", url),
  post: <T>(url: string, body?: unknown) => req<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => req<T>("PUT", url, body),
  patch: <T>(url: string, body?: unknown) => req<T>("PATCH", url, body),
  del: <T>(url: string) => req<T>("DELETE", url),
  upload: async <T>(url: string, file: File, field = "file"): Promise<T> => {
    const fd = new FormData();
    fd.append(field, file);
    const res = await fetch(url, { method: "POST", body: fd, credentials: "same-origin" });
    const data = await res.json().catch(() => undefined);
    if (!res.ok) throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status);
    return data as T;
  },
};

// ---------- 类型 ----------

export interface Subscription {
  id: number;
  name: string;
  url: string;
  user_agent: string;
  update_interval: number;
  via_proxy: boolean;
  enabled: boolean;
  last_update: string;
  node_count: number;
  user_info: string;
  created_at: string;
}

export interface ProxyNode {
  id: number;
  name: string;
  type: string;
  server: string;
  port: number;
  region: string;
  source_type: "sub" | "manual";
  source_id: number;
  source_name?: string;
  raw_config: Record<string, unknown>;
  dedup_hash: string;
  enabled: boolean;
  latency: number;
  latency_at: string;
  alive: boolean;
  created_at: string;
}

export interface RegionInfo {
  code: string;
  flag: string;
  cn: string;
  count?: number;
}

export interface RuleTemplate {
  id: number;
  name: string;
  source: "url" | "paste";
  url: string;
  content: string;
  mapping: Record<string, string>;
  active: boolean;
  updated_at: string;
}

export interface Rule {
  id: number;
  template_id: number;
  kind: string;
  value: string;
  target: string;
  no_resolve: boolean;
  position: number;
  enabled: boolean;
}

export interface RuleProvider {
  id: number;
  template_id: number;
  name: string;
  url: string;
  behavior: string;
  format: string;
  interval: number;
}

export interface ProxyGroup {
  id: number;
  name: string;
  type: "select" | "url-test" | "fallback" | "load-balance";
  region: string;
  include_regex: string;
  test_url: string;
  interval: number;
  tolerance: number;
  icon: string;
  position: number;
  enabled: boolean;
}

export interface RulesPayload {
  rules: Rule[];
  providers: RuleProvider[];
  active_template: { id: number; name: string; mapping: Record<string, string> } | null;
}

export interface GenResult {
  yaml: string;
  node_count: number;
  group_count: number;
  rule_count: number;
}

export interface MetaInfo {
  version: string;
  core: {
    installed: boolean;
    version: string;
    state: string;
    pid: number;
    restarts: number;
    last_error: string;
  };
}

export interface CoreStatus {
  installed: boolean;
  installed_version: string;
  state: string;
  pid: number;
  restarts: number;
  last_error: string;
  downloading: boolean;
  download_error: string;
  latest_version: string;
}

export interface Settings {
  mixed_port: number;
  allow_lan: boolean;
  log_level: string;
  tun_enable: boolean;
  tun_stack: string;
  dns_enable: boolean;
  dns_mode: string;
  dns_nameserver: string[];
  dns_fallback: string[];
  geox_urls: Record<string, string>;
  update_repo: string;
  core_mirror: string;
}

export interface UpdateCheck {
  current: string;
  latest: string;
  has_update: boolean;
  notes: string;
  url: string;
  error?: string;
}

// ---------- mihomo 直通 ----------

export interface MihomoProxy {
  name: string;
  type: string;
  now?: string;
  all?: string[];
  alive?: boolean;
  history?: { time: string; delay: number }[];
}

export interface MihomoProxiesResp {
  proxies: Record<string, MihomoProxy>;
}

export interface MihomoConnectionMeta {
  network: string;
  type: string;
  sourceIP: string;
  destinationPort: string;
  host: string;
  destinationIP: string;
  process?: string;
}

export interface MihomoConnection {
  id: string;
  upload: number;
  download: number;
  start: string;
  chains: string[];
  rule: string;
  rulePayload: string;
  metadata: MihomoConnectionMeta;
}

export interface MihomoConnectionsResp {
  connections: MihomoConnection[] | null;
  uploadTotal: number;
  downloadTotal: number;
}

export const mihomo = {
  proxies: () => api.get<MihomoProxiesResp>("/api/mihomo/proxies"),
  select: (group: string, name: string) =>
    api.put(`/api/mihomo/proxies/${encodeURIComponent(group)}`, { name }),
  closeConn: (id: string) => api.del(`/api/mihomo/connections/${encodeURIComponent(id)}`),
  closeAllConns: () => api.del("/api/mihomo/connections"),
  patchMode: (mode: string) => api.patch("/api/mihomo/configs", { mode }),
};
