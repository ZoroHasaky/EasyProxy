import { useLanguage } from "@/contexts/language";
import { cn } from "@/lib/utils";

interface LanguageToggleProps {
  className?: string;
  variant?: "button" | "switch";
}

export function LanguageToggle({ className, variant = "button" }: LanguageToggleProps) {
  const { language, toggleLanguage } = useLanguage();
  const chinese = language === "zh-CN";
  const label = chinese ? "Switch to English" : "切换为中文";

  if (variant === "switch") {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={!chinese}
        onClick={toggleLanguage}
        title={label}
        aria-label={label}
        className={cn(
          "relative flex h-9 w-[4.5rem] shrink-0 items-center rounded-full border border-border/80 bg-card/60 px-1 text-[10px] font-bold shadow-2xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className,
        )}
      >
        <span className={cn("z-10 flex w-1/2 justify-center transition-colors", chinese ? "text-primary-foreground" : "text-muted-foreground")}>中</span>
        <span className={cn("z-10 flex w-1/2 justify-center transition-colors", chinese ? "text-muted-foreground" : "text-primary-foreground")}>EN</span>
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-primary shadow-sm transition-transform duration-200 ease-out",
            !chinese && "translate-x-full",
          )}
        />
      </button>
    );
  }

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
