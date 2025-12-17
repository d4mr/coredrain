import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info";
  size?: "sm" | "md";
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  size = "sm",
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full",
        // Sizes
        size === "sm" && "text-xs px-2 py-0.5",
        size === "md" && "text-sm px-2.5 py-1",
        // Variants
        variant === "default" &&
          "bg-bg-surface text-text-secondary border border-border-default",
        variant === "success" &&
          "bg-positive/15 text-positive border border-positive/30",
        variant === "warning" &&
          "bg-warning/15 text-warning border border-warning/30",
        variant === "error" &&
          "bg-negative/15 text-negative border border-negative/30",
        variant === "info" &&
          "bg-info/15 text-info border border-info/30",
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * Status badge specifically for transfer status
 */
export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "matched"
      ? "success"
      : status === "pending"
        ? "warning"
        : "error";

  return (
    <Badge variant={variant}>
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full mr-1.5",
          status === "matched" && "bg-positive",
          status === "pending" && "bg-warning",
          status === "failed" && "bg-negative"
        )}
      />
      {status}
    </Badge>
  );
}
