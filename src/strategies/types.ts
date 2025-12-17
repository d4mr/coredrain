/**
 * Common types for block fetching strategies.
 *
 * Both RPC and S3 strategies implement the same interface,
 * allowing the finder to switch between them for live vs backfill.
 *
 * Important distinction between transaction fields and asset transfer fields:
 *
 * Transaction fields (from the raw EVM tx):
 *   tx.from = system address (0x2222... for HYPE, 0x2000...{assetId} for tokens)
 *   tx.to   = user address for HYPE, but ERC20 contract address for tokens!
 *   tx.value = transfer amount for HYPE, but 0 for ERC20 (amount is in calldata)
 *
 * Asset transfer fields (what we actually care about for matching):
 *   assetRecipient = the user receiving the asset (always the user)
 *   amountWei = asset amount in smallest units (parsed from tx.value or calldata)
 *
 * We normalize everything into asset transfer fields so matching logic doesn't
 * have to care whether it's HYPE or an ERC20. The parsers in s3.ts and rpc.ts
 * handle extracting the right values from each tx type.
 */

import { Context, Data, Effect } from "effect";

/**
 * System transaction extracted from a block.
 *
 * This represents a single asset transfer from the system to a user.
 * Fields are normalized so HYPE and ERC20 transfers look the same.
 */
export interface SystemTx {
  /** Transaction hash (Hyperliquid internal hash with r=0, s=0) */
  hash: string;
  /** Explorer-compatible transaction hash (r=1, s=from address) */
  explorerHash: string;
  /** System address that sent the asset (tx.from). 0x2222... for HYPE, 0x2000...{assetId} for tokens */
  from: string;
  /** User address receiving the asset. For HYPE this is tx.to, for ERC20 it's decoded from calldata */
  assetRecipient: string;
  /** Asset amount in smallest units (wei for HYPE, token units for ERC20). String to preserve precision */
  amountWei: string;
  /** ERC20 contract address, or null for native HYPE transfers */
  contractAddress: string | null;
}

/** Block data with system transactions */
export interface BlockData {
  /** Block number */
  number: number;
  /** Block hash */
  hash: string;
  /** Block timestamp in milliseconds */
  timestamp: number;
  /** System transactions in this block */
  systemTxs: SystemTx[];
}

/** Error when fetching blocks fails */
export class BlockFetchError extends Data.TaggedError("BlockFetchError")<{
  readonly message: string;
  readonly strategy: string;
  readonly cause?: unknown;
}> {}

/** Interface for block fetching strategies */
export interface BlockFetcherService {
  /** Strategy name for logging */
  readonly name: string;

  /**
   * Fetch multiple blocks with their system transactions.
   * @param blockNumbers - Array of block numbers to fetch
   * @returns Effect that yields array of block data, sorted by block number
   */
  fetchBlocks(
    blockNumbers: number[]
  ): Effect.Effect<BlockData[], BlockFetchError>;
}

/**
 * S3 Block Fetcher service tag.
 * Uses AWS S3 to fetch blocks, fast but costs money.
 */
export class S3Fetcher extends Context.Tag("S3Fetcher")<
  S3Fetcher,
  BlockFetcherService
>() {}

/**
 * RPC Block Fetcher service tag.
 * Uses HyperEVM JSON-RPC, free but slower.
 */
export class RpcFetcher extends Context.Tag("RpcFetcher")<
  RpcFetcher,
  BlockFetcherService
>() {}
