import type { Transfer } from "@/types";
import { StatusBadge } from "./Badge";
import { CopyButton } from "./CopyButton";
import { ExternalLinkIcon } from "./Icons";
import {
  formatHash,
  formatAddress,
  formatAmount,
  formatDate,
  getExplorerUrl,
  cn,
} from "@/lib/utils";

interface TransferDetailProps {
  transfer: Transfer;
  onClose?: () => void;
  expanded?: boolean;
}

export function TransferDetail({
  transfer,
  onClose,
  expanded = false,
}: TransferDetailProps) {
  const hasUsdValue = transfer.usdcValue && parseFloat(transfer.usdcValue) > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-semibold text-text-primary font-mono">
              {formatAmount(transfer.amount)}
            </span>
            <span className="text-lg text-text-secondary">{transfer.token}</span>
          </div>
          {hasUsdValue && (
            <span className="text-sm text-text-tertiary font-mono">
              ${formatAmount(transfer.usdcValue!, 2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={transfer.status} />
          {onClose && (
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-primary p-1 rounded hover:bg-bg-hover transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Transfer Details Grid */}
      <div className="grid grid-cols-2 gap-3">
        <DetailCard label="Amount" value={formatAmount(transfer.amount)} subValue={transfer.token} />
        <DetailCard 
          label="USD Value" 
          value={hasUsdValue ? `$${formatAmount(transfer.usdcValue!, 2)}` : "—"} 
          muted={!hasUsdValue}
        />
      </div>

      {/* Fees (if any) */}
      {(transfer.fee || transfer.nativeTokenFee) && (
        <div className="flex gap-3 text-sm">
          {transfer.fee && parseFloat(transfer.fee) > 0 && (
            <span className="text-text-tertiary">
              Fee: <span className="text-text-secondary font-mono">{transfer.fee} {transfer.token}</span>
            </span>
          )}
          {transfer.nativeTokenFee && parseFloat(transfer.nativeTokenFee) > 0 && (
            <span className="text-text-tertiary">
              Gas: <span className="text-text-secondary font-mono">{transfer.nativeTokenFee} HYPE</span>
            </span>
          )}
        </div>
      )}

      {/* HyperCore Section */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-hl-green uppercase tracking-wider">
          HyperCore
        </h4>
        <div className="bg-bg-surface rounded-lg p-3 space-y-2.5">
          <DetailRow label="Tx Hash">
            <span className="font-mono text-sm text-text-primary">
              {formatHash(transfer.hypercoreHash, 10)}
            </span>
            <CopyButton text={transfer.hypercoreHash} />
          </DetailRow>
          <DetailRow label="Time">
            <span className="text-sm text-text-secondary">{formatDate(transfer.hypercoreTime)}</span>
          </DetailRow>
          <DetailRow label="From">
            <span className="font-mono text-sm text-text-primary">
              {expanded ? transfer.watchedAddress : formatAddress(transfer.watchedAddress, 6)}
            </span>
            <CopyButton text={transfer.watchedAddress} />
          </DetailRow>
          <DetailRow label="To">
            <span className="font-mono text-sm text-text-primary">
              {expanded ? transfer.user : formatAddress(transfer.user, 6)}
            </span>
            <CopyButton text={transfer.user} />
          </DetailRow>
          <DetailRow label="System Address">
            <span className="font-mono text-xs text-text-tertiary">
              {formatAddress(transfer.systemAddress, 6)}
            </span>
            <CopyButton text={transfer.systemAddress} />
          </DetailRow>
        </div>
      </div>

      {/* HyperEVM Section */}
      {transfer.status === "matched" && transfer.hyperevmHash && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-positive uppercase tracking-wider">
            HyperEVM (Matched)
          </h4>
          <div className="bg-bg-surface rounded-lg p-3 space-y-2.5">
            {/* Explorer Hash - the one that works on block explorers */}
            {transfer.hyperevmExplorerHash && (
              <DetailRow label="Explorer Hash">
                <span className="font-mono text-sm text-text-primary">
                  {formatHash(transfer.hyperevmExplorerHash, 8)}
                </span>
                <CopyButton text={transfer.hyperevmExplorerHash} />
                <a
                  href={getExplorerUrl(transfer.hyperevmExplorerHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-hl-green hover:text-hl-green-light transition-colors"
                >
                  <ExternalLinkIcon />
                </a>
              </DetailRow>
            )}
            {/* Internal Hash - Hyperliquid's internal format */}
            <DetailRow label="Internal Hash">
              <span className="font-mono text-sm text-text-tertiary">
                {formatHash(transfer.hyperevmHash, 8)}
              </span>
              <CopyButton text={transfer.hyperevmHash} />
            </DetailRow>
            {transfer.hyperevmBlock && (
              <DetailRow label="Block">
                <span className="font-mono text-sm text-text-primary">
                  {transfer.hyperevmBlock.toLocaleString()}
                </span>
              </DetailRow>
            )}
            {transfer.hyperevmTime && (
              <DetailRow label="Time">
                <span className="text-sm text-text-secondary">{formatDate(transfer.hyperevmTime)}</span>
              </DetailRow>
            )}
            {transfer.hyperevmBlockHash && expanded && (
              <DetailRow label="Block Hash">
                <span className="font-mono text-xs text-text-tertiary">
                  {formatHash(transfer.hyperevmBlockHash, 8)}
                </span>
                <CopyButton text={transfer.hyperevmBlockHash} />
              </DetailRow>
            )}
            {transfer.contractAddress && (
              <DetailRow label="Contract">
                <span className="font-mono text-sm text-text-primary">
                  {expanded ? transfer.contractAddress : formatAddress(transfer.contractAddress, 6)}
                </span>
                <CopyButton text={transfer.contractAddress} />
                <a
                  href={getExplorerUrl(transfer.contractAddress, "address")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-hl-green hover:text-hl-green-light transition-colors"
                >
                  <ExternalLinkIcon />
                </a>
              </DetailRow>
            )}
          </div>
        </div>
      )}

      {/* Pending Status */}
      {transfer.status === "pending" && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-warning uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
            Pending Match
          </h4>
          <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 text-sm text-warning">
            Searching for corresponding HyperEVM transaction...
          </div>
        </div>
      )}

      {/* Failed Reason */}
      {transfer.status === "failed" && transfer.failReason && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-negative uppercase tracking-wider">
            Match Failed
          </h4>
          <div className="bg-negative/10 border border-negative/20 rounded-lg p-3 text-sm text-negative">
            {transfer.failReason}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-text-tertiary shrink-0 w-24">{label}</span>
      <div className="flex items-center gap-2 min-w-0 justify-end">{children}</div>
    </div>
  );
}

function DetailCard({
  label,
  value,
  subValue,
  muted = false,
}: {
  label: string;
  value: string;
  subValue?: string;
  muted?: boolean;
}) {
  return (
    <div className="bg-bg-surface rounded-lg p-3">
      <div className="text-xs text-text-tertiary mb-1">{label}</div>
      <div className={cn(
        "font-mono font-medium",
        muted ? "text-text-tertiary" : "text-text-primary"
      )}>
        {value}
        {subValue && <span className="text-text-secondary ml-1 font-normal">{subValue}</span>}
      </div>
    </div>
  );
}
