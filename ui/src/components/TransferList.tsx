import { useState, useMemo, useEffect, useRef } from "react";
import { useTransfers } from "@/hooks/useTransfers";
import { useAssets } from "@/hooks/useAssets";
import { Card, CardHeader } from "./Card";
import { StatusBadge } from "./Badge";
import { Button } from "./Button";
import { CopyButton } from "./CopyButton";
import { SkeletonRow } from "./Skeleton";
import { ExternalLinkIcon, RefreshIcon } from "./Icons";
import { Select, type SelectOption } from "./Select";
import { TokenImage } from "./TokenImage";
import { TransferModal } from "./TransferModal";
import type { Transfer, TransferStatus } from "@/types";
import {
  formatHash,
  formatAddress,
  formatAmount,
  formatRelativeTime,
  getExplorerUrl,
  cn,
} from "@/lib/utils";

const STATUS_FILTERS: { label: string; value: TransferStatus | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Pending", value: "pending" },
  { label: "Matched", value: "matched" },
  { label: "Failed", value: "failed" },
];

const PAGE_SIZE = 20;

export function TransferList() {
  const [statusFilter, setStatusFilter] = useState<TransferStatus | undefined>();
  const [tokenFilter, setTokenFilter] = useState<string | undefined>();
  const [addressFilter, setAddressFilter] = useState<string | undefined>();
  const [page, setPage] = useState(0);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: assets } = useAssets();

  const { data, isLoading, error, refetch, isFetching } = useTransfers(
    {
      status: statusFilter,
      token: tokenFilter,
      watchedAddress: addressFilter,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    },
    5000
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [statusFilter, tokenFilter, addressFilter]);

  // Handle refresh with minimum spin duration
  const handleRefresh = () => {
    setIsSpinning(true);
    refetch();
    
    // Clear any existing timeout
    if (spinTimeoutRef.current) {
      clearTimeout(spinTimeoutRef.current);
    }
    
    // Minimum 1 second spin
    spinTimeoutRef.current = setTimeout(() => {
      setIsSpinning(false);
    }, 1000);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current);
      }
    };
  }, []);

  // Build token options from assets
  const tokenOptions: SelectOption[] = useMemo(() => {
    if (!assets) return [];
    return assets.map((token) => ({
      value: token.name,
      label: token.name,
      icon: <TokenImage token={token.name} size="sm" />,
      description: token.fullName || undefined,
    }));
  }, [assets]);

  // Build address options from transfers data (unique watched addresses)
  const addressOptions: SelectOption[] = useMemo(() => {
    if (!data?.data) return [];
    const addresses = new Set<string>();
    data.data.forEach((t) => addresses.add(t.watchedAddress));
    return Array.from(addresses).map((addr) => ({
      value: addr,
      label: formatAddress(addr, 6),
      description: addr,
    }));
  }, [data]);

  const hasFilters = statusFilter || tokenFilter || addressFilter;

  const clearFilters = () => {
    setStatusFilter(undefined);
    setTokenFilter(undefined);
    setAddressFilter(undefined);
  };

  // Pagination calculations
  const totalPages = data ? Math.ceil(data.pagination.total / PAGE_SIZE) : 0;
  const hasNextPage = data ? (page + 1) * PAGE_SIZE < data.pagination.total : false;
  const hasPrevPage = page > 0;

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border-default">
        <div className="flex flex-col gap-4">
          {/* Title Row */}
          <div className="flex items-center justify-between">
            <CardHeader className="!mb-0">
              <span className="flex items-center gap-2">
                Recent Transfers
                <span className="live-indicator text-xs text-text-tertiary font-normal normal-case tracking-normal">
                  Live
                </span>
              </span>
            </CardHeader>

            <div className="flex items-center gap-2">
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                className="!p-2"
                disabled={isSpinning || isFetching}
              >
                <RefreshIcon className={cn((isSpinning || isFetching) && "animate-spin-reverse")} />
              </Button>
            </div>
          </div>

          {/* Filters Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left side - Status Filter */}
            <div className="flex bg-bg-surface rounded-md p-1 gap-1">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.label}
                  onClick={() => setStatusFilter(filter.value)}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded transition-colors",
                    statusFilter === filter.value
                      ? "bg-bg-hover text-text-primary"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {/* Right side - Token & Address Filters */}
            <div className="flex items-center gap-3">
              {/* Address Filter */}
              {addressOptions.length > 1 && (
                <Select
                  options={addressOptions}
                  value={addressFilter}
                  onChange={setAddressFilter}
                  placeholder="All addresses"
                  searchPlaceholder="Search addresses..."
                  className="min-w-[160px]"
                />
              )}

              {/* Token Filter */}
              <Select
                options={tokenOptions}
                value={tokenFilter}
                onChange={setTokenFilter}
                placeholder="All tokens"
                searchPlaceholder="Search tokens..."
                className="min-w-[140px]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-8 text-center text-negative">
          Failed to load transfers: {error.message}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="divide-y divide-border-default">
          {[...Array(5)].map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {/* Transfer List */}
      {!isLoading && data && (
        <div className="divide-y divide-border-default">
          {data.data.length === 0 ? (
            <div className="p-8 text-center text-text-secondary">
              No transfers found
            </div>
          ) : (
            data.data.map((transfer, index) => (
              <TransferRow
                key={transfer._id}
                transfer={transfer}
                onClick={() => setSelectedTransfer(transfer)}
                delay={index}
              />
            ))
          )}
        </div>
      )}

      {/* Pagination */}
      {data && data.pagination.total > PAGE_SIZE && (
        <div className="p-4 border-t border-border-default flex items-center justify-between">
          <div className="text-sm text-text-tertiary">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, data.pagination.total)} of{" "}
            {data.pagination.total.toLocaleString()} transfers
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(p => p - 1)}
              disabled={!hasPrevPage}
            >
              Previous
            </Button>
            <span className="text-sm text-text-secondary px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={!hasNextPage}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      <TransferModal
        transfer={selectedTransfer}
        onClose={() => setSelectedTransfer(null)}
      />
    </Card>
  );
}

interface TransferRowProps {
  transfer: Transfer;
  onClick: () => void;
  delay: number;
}

function TransferRow({ transfer, onClick, delay }: TransferRowProps) {
  const hasUsdValue = transfer.usdcValue && parseFloat(transfer.usdcValue) > 0;

  return (
    <div
      className={cn(
        "flex items-center gap-4 p-4 hover:bg-bg-hover cursor-pointer transition-colors",
        "animate-fade-in opacity-0"
      )}
      style={{ animationDelay: `${delay * 30}ms`, animationFillMode: "forwards" }}
      onClick={onClick}
    >
      {/* Token Image + Amount + USD */}
      <div className="w-40 shrink-0 flex items-center gap-3">
        <TokenImage token={transfer.token} size="md" />
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono font-medium text-text-primary">
              {formatAmount(transfer.amount, 2)}
            </span>
            <span className="text-xs text-text-tertiary">{transfer.token}</span>
          </div>
          {hasUsdValue && (
            <div className="text-xs text-text-tertiary font-mono">
              ${formatAmount(transfer.usdcValue!, 2)}
            </div>
          )}
        </div>
      </div>

      {/* Status */}
      <div className="w-24 shrink-0">
        <StatusBadge status={transfer.status} />
      </div>

      {/* Hashes */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-tertiary">Core:</span>
          <span className="font-mono text-sm text-text-secondary">
            {formatHash(transfer.hypercoreHash, 6)}
          </span>
        </div>
        {transfer.hyperevmExplorerHash && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-text-tertiary">EVM:</span>
            <span className="font-mono text-text-secondary">{formatHash(transfer.hyperevmExplorerHash, 6)}</span>
            <a
              href={getExplorerUrl(transfer.hyperevmExplorerHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-hl-green hover:text-hl-green-light"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLinkIcon className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>

      {/* Addresses */}
      <div className="hidden lg:block w-40">
        <div className="flex items-center gap-1">
          <span className="font-mono text-sm text-text-secondary">
            {formatAddress(transfer.user, 4)}
          </span>
          <CopyButton text={transfer.user} />
        </div>
        <div className="text-xs text-text-tertiary">recipient</div>
      </div>

      {/* Time */}
      <div className="w-20 text-right shrink-0">
        <div className="text-sm text-text-secondary">
          {formatRelativeTime(transfer.hypercoreTime)}
        </div>
      </div>
    </div>
  );
}
