import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function Button({
  children,
  className,
  variant = "secondary",
  size = "md",
  loading,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-md transition-all focus-ring",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        // Variants
        variant === "primary" &&
          "bg-hl-green text-bg-primary hover:bg-hl-green-light hover:shadow-glow active:scale-[0.98]",
        variant === "secondary" &&
          "bg-bg-surface border border-border-accent text-text-primary hover:border-hl-green hover:text-hl-green",
        variant === "ghost" &&
          "bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-hover",
        // Sizes
        size === "sm" && "text-xs px-3 py-1.5 gap-1.5",
        size === "md" && "text-sm px-4 py-2 gap-2",
        size === "lg" && "text-base px-6 py-3 gap-2",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
