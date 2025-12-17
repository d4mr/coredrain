import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "elevated" | "bordered";
  padding?: "none" | "sm" | "md" | "lg";
}

export function Card({
  children,
  className,
  variant = "default",
  padding = "md",
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg transition-colors",
        variant === "default" && "bg-bg-secondary border border-border-default",
        variant === "elevated" &&
          "bg-bg-tertiary border border-border-subtle shadow-card",
        variant === "bordered" && "bg-transparent border border-border-accent",
        padding === "sm" && "p-3",
        padding === "md" && "p-4",
        padding === "lg" && "p-6",
        padding === "none" && "p-0",
        className
      )}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function CardHeader({ children, className, action }: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between mb-4",
        className
      )}
    >
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
        {children}
      </h3>
      {action && <div>{action}</div>}
    </div>
  );
}

interface CardValueProps {
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

export function CardValue({ children, className, size = "lg" }: CardValueProps) {
  return (
    <div
      className={cn(
        "font-mono font-semibold text-text-primary tabular-nums",
        size === "sm" && "text-lg",
        size === "md" && "text-xl",
        size === "lg" && "text-2xl",
        size === "xl" && "text-3xl",
        className
      )}
    >
      {children}
    </div>
  );
}
