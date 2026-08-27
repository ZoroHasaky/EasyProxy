import { useLanguage } from "@/contexts/language";
import { cn } from "@/lib/utils";

export function LanguageToggle({ className }: { className?: string }) {
  const { language, toggleLanguage } = useLanguage();
  const chinese = language === "zh-CN";
  const label = chinese ? "Switch to English" : "切换为中文";

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-xl border border-border/80 bg-card/60 text-xs font-bold text-muted-foreground shadow-2xs transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      {chinese ? "EN" : "中"}
    </button>
  );
}
