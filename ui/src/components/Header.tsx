import { useHealth } from "@/hooks/useStats";
import { SearchBar } from "./SearchBar";
import { cn } from "@/lib/utils";

export function Header() {
  const { data: health, isError } = useHealth();
  const isHealthy = health?.status === "ok";

  return (
    <header className="border-b border-border-default bg-bg-secondary/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-hl-green/20 flex items-center justify-center">
              <svg
                viewBox="0 0 32 32"
                className="w-5 h-5 text-hl-green"
                fill="currentColor"
              >
                <path d="M8 16L14 10L20 16L14 22L8 16Z" />
                <path d="M14 16L20 10L26 16L20 22L14 16Z" opacity="0.5" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-text-primary tracking-tight">
                Coredrain
              </h1>
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <span>Explorer</span>
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    isError
                      ? "bg-negative"
                      : isHealthy
                        ? "bg-positive"
                        : "bg-warning animate-pulse"
                  )}
                />
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="flex-1 max-w-xl">
            <SearchBar />
          </div>

          {/* Links */}
          <div className="hidden md:flex items-center gap-4">
            <a
              href="https://github.com/your-repo/coredrain"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-tertiary hover:text-text-primary transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
                />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
