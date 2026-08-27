import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

export type Language = "zh-CN" | "en";

interface LanguageState {
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
}

const STORAGE_KEY = "easyproxy-language";
const LanguageContext = createContext<LanguageState | null>(null);

export function getCurrentLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "zh-CN" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getCurrentLanguage);

  useLayoutEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.title = language === "zh-CN"
      ? "EasyProxy | 节点聚合与代理面板"
      : "EasyProxy | Proxy Management Panel";
  }, [language]);

  const value = useMemo<LanguageState>(() => ({
    language,
    locale: language === "zh-CN" ? "zh-CN" : "en-US",
    setLanguage,
    toggleLanguage: () => setLanguage((current) => current === "zh-CN" ? "en" : "zh-CN"),
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used within LanguageProvider");
  return value;
}

export function defineMessages<
  const ZH extends Record<string, string>,
  const EN extends { [K in keyof ZH]: string },
>(zh: ZH, en: EN & Record<Exclude<keyof EN, keyof ZH>, never>) {
  return { "zh-CN": zh, en } as const;
}

export function useMessages<const T extends Record<Language, Record<string, string>>>(messages: T): T[Language] {
  const { language } = useLanguage();
  return messages[language];
}

type MessageParameterKeys<Template extends string> =
  Template extends `${string}{${infer Key}}${infer Rest}` ? Key | MessageParameterKeys<Rest> : never;

export function formatMessage<const Template extends string>(
  template: Template,
  values: Record<MessageParameterKeys<Template>, string | number>,
) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, key: string) => {
    const parameterKey = key as MessageParameterKeys<Template>;
    return Object.prototype.hasOwnProperty.call(values, parameterKey) ? String(values[parameterKey]) : placeholder;
  });
}

const regionNames = defineMessages({
  HK: "香港", TW: "台湾", JP: "日本", KR: "韩国", SG: "新加坡", MY: "马来西亚", TH: "泰国",
  PH: "菲律宾", VN: "越南", ID: "印度尼西亚", IN: "印度", TR: "土耳其", RU: "俄罗斯",
  US: "美国", CA: "加拿大", MX: "墨西哥", BR: "巴西", AR: "阿根廷", GB: "英国", DE: "德国",
  FR: "法国", NL: "荷兰", CH: "瑞士", SE: "瑞典", IT: "意大利", ES: "西班牙", AE: "阿联酋",
  AU: "澳大利亚", NZ: "新西兰", ZA: "南非", OTHER: "其他",
}, {
  HK: "Hong Kong", TW: "Taiwan", JP: "Japan", KR: "South Korea", SG: "Singapore", MY: "Malaysia", TH: "Thailand",
  PH: "Philippines", VN: "Vietnam", ID: "Indonesia", IN: "India", TR: "Türkiye", RU: "Russia",
  US: "United States", CA: "Canada", MX: "Mexico", BR: "Brazil", AR: "Argentina", GB: "United Kingdom", DE: "Germany",
  FR: "France", NL: "Netherlands", CH: "Switzerland", SE: "Sweden", IT: "Italy", ES: "Spain", AE: "United Arab Emirates",
  AU: "Australia", NZ: "New Zealand", ZA: "South Africa", OTHER: "Other",
});

export function useRegionName() {
  const names = useMessages(regionNames);
  return (code: string, fallback?: string) => names[code as keyof typeof names] ?? fallback ?? code;
}
