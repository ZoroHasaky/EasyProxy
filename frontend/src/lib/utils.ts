import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Language } from "@/contexts/language";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(n: number, decimals = 1): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(decimals)} ${units[i]}`;
}

export function formatSpeed(n: number): string {
  return `${formatBytes(n)}/s`;
}

// mihomo -v 的首行还包含构建信息；面板只展示产品名和语义版本。
export function formatCoreVersion(version: string): string {
  const value = version.trim();
  const match = value.match(/^(Mihomo(?:\s+Meta)?\s+v?\d+\.\d+\.\d+(?:-[\w.]+)?)/i);
  return match?.[1] ?? value;
}

export function subscriptionUsage(userInfo: string) {
  const values = new Map<string, number>();
  for (const item of userInfo.split(/[;&]/)) {
    const [key, raw] = item.trim().split("=", 2);
    const value = Number(raw);
    if (key && Number.isFinite(value)) values.set(key.toLowerCase(), value);
  }
  const total = values.get("total") ?? 0;
  if (total <= 0) return null;

  const used = (values.get("upload") ?? 0) + (values.get("download") ?? 0);
  return {
    usedGB: (used / 1024 ** 3).toFixed(2),
    totalGB: (total / 1024 ** 3).toFixed(2),
    percent: Math.min(100, Math.max(0, (used / total) * 100)),
  };
}

export function formatDuration(startISO: string): string {
  const ms = Date.now() - new Date(startISO).getTime();
  if (ms < 0) return "-";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function timeAgo(iso: string, language: Language = "zh-CN"): string {
  const en = language === "en";
  if (!iso) return en ? "Never" : "从未";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return en ? "Just now" : "刚刚";
  if (s < 3600) return en ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return en ? `${Math.floor(s / 3600)} hr ago` : `${Math.floor(s / 3600)} 小时前`;
  return en ? `${Math.floor(s / 86400)} days ago` : `${Math.floor(s / 86400)} 天前`;
}
