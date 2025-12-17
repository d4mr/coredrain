import { useStats } from "@/hooks/useStats";
import { Card, CardHeader, CardValue } from "./Card";
import { SkeletonCard } from "./Skeleton";
import { formatNumber, formatCompact } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function StatsGrid() {
  const { data: stats, isLoading, error } = useStats();

  if (error) {
    return (
      <div className="text-negative text-sm p-4 bg-negative/10 rounded-lg border border-negative/20">
        Failed to load stats: {error.message}
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  const matchRate =
    stats.transfers.total > 0
      ? ((stats.transfers.matched / stats.transfers.total) * 100).toFixed(1)
      : "0";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Transfers */}
      <Card className="animate-slide-up stagger-1">
        <CardHeader>Total Indexed</CardHeader>
        <CardValue>{formatCompact(stats.transfers.total)}</CardValue>
        <div className="mt-2 text-xs text-text-tertiary font-mono">
          {formatNumber(stats.transfers.total)} transfers
        </div>
      </Card>

      {/* Match Rate */}
      <Card className="animate-slide-up stagger-2">
        <CardHeader>Match Rate</CardHeader>
        <CardValue className="text-positive">{matchRate}%</CardValue>
        <div className="mt-2 text-xs text-text-tertiary">
          <span className="text-positive">{formatNumber(stats.transfers.matched)}</span>
          {" matched"}
        </div>
      </Card>

      {/* Pending */}
      <Card className="animate-slide-up stagger-3">
        <CardHeader>
          <span className="flex items-center gap-2">
            Pending
            {stats.transfers.pending > 0 && (
              <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
            )}
          </span>
        </CardHeader>
        <CardValue
          className={cn(
            stats.transfers.pending > 0 ? "text-warning" : "text-text-secondary"
          )}
        >
          {formatNumber(stats.transfers.pending)}
        </CardValue>
        <div className="mt-2 text-xs text-text-tertiary">
          {stats.transfers.failed > 0 && (
            <span className="text-negative">
              {formatNumber(stats.transfers.failed)} failed
            </span>
          )}
        </div>
      </Card>

      {/* Watched Addresses */}
      <Card className="animate-slide-up stagger-4">
        <CardHeader>Addresses</CardHeader>
        <CardValue>{stats.addresses.active}</CardValue>
        <div className="mt-2 text-xs text-text-tertiary">
          {stats.addresses.total} total ·{" "}
          <span className="font-mono">{formatCompact(stats.blocks.stored)}</span> blocks cached
        </div>
      </Card>
    </div>
  );
}
