import { useState } from "react";
import { getTokenImageUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TokenImageProps {
  token: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "w-4 h-4",
  md: "w-6 h-6",
  lg: "w-8 h-8",
};

export function TokenImage({ token, size = "md", className }: TokenImageProps) {
  const [error, setError] = useState(false);

  if (error) {
    // Fallback to initials
    return (
      <div
        className={cn(
          "rounded-full bg-bg-surface border border-border-default flex items-center justify-center text-text-tertiary font-medium",
          sizeClasses[size],
          size === "sm" && "text-[8px]",
          size === "md" && "text-[10px]",
          size === "lg" && "text-xs",
          className
        )}
      >
        {token.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={getTokenImageUrl(token)}
      alt={token}
      className={cn("rounded-full", sizeClasses[size], className)}
      onError={() => setError(true)}
    />
  );
}
