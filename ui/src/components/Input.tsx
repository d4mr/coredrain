import { cn } from "@/lib/utils";
import type { InputHTMLAttributes, ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  suffix?: ReactNode;
}

export function Input({
  className,
  icon,
  suffix,
  ...props
}: InputProps) {
  return (
    <div className="relative">
      {icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
          {icon}
        </div>
      )}
      <input
        className={cn(
          "w-full bg-bg-surface border border-border-default rounded-md",
          "text-text-primary placeholder:text-text-tertiary",
          "focus:outline-none focus:border-hl-green focus:ring-2 focus:ring-hl-green/20",
          "transition-all duration-150",
          icon ? "pl-10" : "pl-4",
          suffix ? "pr-10" : "pr-4",
          "py-2.5 text-sm",
          className
        )}
        {...props}
      />
      {suffix && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary">
          {suffix}
        </div>
      )}
    </div>
  );
}
