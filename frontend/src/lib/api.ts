// 后端 API 客户端与完整类型定义

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers:
        body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("无法连接后端服务", 0);
  }
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
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        body: fd,
        credentials: "same-origin",
      });
    } catch {
      throw new ApiError("无法连接后端服务", 0);
    }
    const data = await res.json().catch(() => undefined);
    if (!res.ok)
      throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status);
    return data as T;
  },
};

// ---------- 数据类型 ----------

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
  base_target: string;
  target_override: boolean;
  no_resolve: boolean;
  position: number;
  enabled: boolean;
}

export interface RuleTargetOption {
  value: string;
  kind: "region_group" | "group" | "node";
  name: string;
  region: string;
  region_name: string;
  icon: string;
  source_name?: string;
  member_count?: number;
  available: boolean;
  alive?: boolean;
  latency?: number;
}

export interface RuleProvider {
  id: number;
  template_id: number;
  name: string;
  url: string;
  behavior: string;
  format: string;
  interval: number;
  status?:
    | "downloaded"
    | "not_downloaded"
    | "not_loaded"
    | "core_stopped"
    | "unknown";
  rule_count?: number;
}

export interface RuleTemplatePreview {
  rules: Rule[];
  providers: RuleProvider[];
  targets: string[];
  mapping: Record<string, string>;
}

export interface RuleProviderContent {
  provider: RuleProvider;
  expandable: boolean;
  items: string[];
  total: number;
  page: number;
  size: number;
}

export interface RecognitionRule {
  id: number;
  name: string;
  kind: string;
  conditions: string[];
  source_url?: string;
  source_behavior?: "domain" | "ipcidr" | "classical";
  source_interval?: number;
  priority: number;
  enabled: boolean;
}

export interface RecognitionRuleImportResponse extends AutoApplyResponse {
  ok: boolean;
  count: number;
  rules: RecognitionRule[];
}

export interface GeoRecognitionPreset {
  id: string;
  name: string;
  kind: "GEOIP" | "GEOSITE";
  condition: string;
  available: boolean;
  reason?: string;
}

export interface GeoRecognitionPresetCatalog {
  available: boolean;
  message?: string;
  presets: GeoRecognitionPreset[];
}

export interface GeoRecognitionGenerationResponse extends AutoApplyResponse {
  ok: boolean;
  count: number;
  created: RecognitionRule[];
  skipped: { id: string; reason: string }[];
}

export interface OutboundRule {
  id: number;
  recognition_id: number;
  group_id: number;
  enabled: boolean;
}

export interface ProxyGroup {
  id: number;
  name: string;
  type: "select" | "url-test" | "fallback" | "load-balance";
  member_mode: "all" | "region" | "manual" | "regex";
  node_ids: number[];
  region: string;
  include_regex: string;
  test_url: string;
  interval: number;
  tolerance: number;
  icon: string;
  position: number;
  enabled: boolean;
}

// 仅用于界面展示；内核配置和 API 仍使用 Mihomo 原始类型值。
export function proxyGroupTypeLabel(type: string) {
  return type === "url-test" ? "自动测速" : type;
}

export interface RulesPayload {
  rules: Rule[];
  providers: RuleProvider[];
}

export interface GenResult {
  yaml: string;
  node_count: number;
  group_count: number;
  rule_count: number;
}

export interface MetaInfo {
  version: string;
  system: {
    release_repo: string;
    commit: string;
    build_type: string;
    build_time: string;
    deployment: string;
    go_version: string;
    architecture: string;
    timezone: string;
  };
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
  memory_bytes: number;
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
  geo_enabled: boolean;
  geo_auto_update: boolean;
  geo_update_interval: number;
  geox_urls: Record<string, string[]>;
  default_geox_urls: Record<string, string[]>;
  core_mirror: string;
}

export interface PendingConfigItem {
  scope: string;
  fields: string[];
  status: "pending" | "failed";
  updated_at: string;
  last_error?: string;
}

export interface PendingConfigResponse {
  count: number;
  items: PendingConfigItem[];
}

export interface ConfigApplyResult {
  ok: boolean;
  result: "saved" | "started" | "reloaded" | "restarted";
}

export type AutoApplyResult = "" | "saved" | "started" | "reloaded" | "restarted";

// 所有节点、订阅和规则写接口都保留数据保存结果；自动同步到内核失败时
// 通过 apply_error 告知前端，但 HTTP 仍成功，避免误导用户以为编辑丢失。
export interface AutoApplyResponse {
  apply_result?: AutoApplyResult;
  apply_error?: string;
}

export function autoApplyResultMessage(result?: AutoApplyResult) {
  switch (result) {
    case "reloaded":
      return "已热重载生效";
    case "restarted":
      return "已重启内核生效";
    case "started":
      return "已启动内核生效";
    case "saved":
      return "配置已保存，内核安装后生效";
    default:
      return "已保存";
  }
}

export interface GeoDataStatus {
  key: "geoip" | "geosite";
  name: string;
  file: string;
  source: string;
  state: "not_downloaded" | "ready" | "loaded" | "disabled" | "error";
  message: string;
  size_bytes: number;
  updated_at?: string;
  counts_available: boolean;
  group_count: number;
  entry_count: number;
}

export interface GeoDataStatusResponse {
  enabled: boolean;
  core_running: boolean;
  items: GeoDataStatus[];
}

export type AuditLogCategory = "traffic" | "operation" | "core";
export type AuditLogLevel = "info" | "success" | "warning" | "error";

export interface AuditLog {
  id: number;
  created_at: string;
  category: AuditLogCategory;
  level: AuditLogLevel;
  event: string;
  summary: string;
  details: Record<string, unknown>;
}

export interface AuditLogResponse {
  items: AuditLog[];
  next_before: number;
}

export interface UpdateCheck {
  current: string;
  latest: string;
  has_update: boolean;
  notes: string;
  url: string;
  error?: string;
}

export interface UpdateStatus {
  state:
    | "idle"
    | "checking"
    | "downloading"
    | "verifying"
    | "installing"
    | "restarting"
    | "ready"
    | "error";
  running: boolean;
  completed: number;
  total: number;
  percent: number;
  version: string;
  error?: string;
  via_proxy: boolean;
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
  sourcePort?: string;
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
  closeConn: (id: string) =>
    api.del(`/api/mihomo/connections/${encodeURIComponent(id)}`),
  closeAllConns: () => api.del("/api/mihomo/connections"),
  patchMode: (mode: string) => api.patch("/api/mihomo/configs", { mode }),
};
