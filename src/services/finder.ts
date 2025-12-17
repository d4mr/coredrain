/**
 * EVM Transaction Hash Finder.
 *
 * Locates the HyperEVM transaction that corresponds to a HyperCore transfer.
 * Uses binary search with interpolation for efficient block finding.
 *
 * Algorithm:
 * 1. Check MongoDB cache for direct match
 * 2. Get initial bounds from MongoDB anchors
 * 3. Interpolate to estimate target block
 * 4. Fetch batch of blocks around estimate
 * 5. Search for match in fetched blocks
 * 6. If not found, use fetched blocks to tighten bounds
 * 7. Re-interpolate with tighter bounds and repeat
 *
 * Each fetch tightens the bounding box, converging on the target.
 *
 * Effect is used here because finding a transaction involves multiple fallible
 * operations (DB queries, RPC/S3 fetches) with different error types. Effect's
 * typed errors let us distinguish NotFoundError (exhaustive search completed)
 * from DbQueryError (can retry) from network errors, and long searches can be
 * cleanly interrupted on shutdown.
 */

import { Effect, Data } from "effect";
import {
  findBracketingAnchors,
  storeBlocksSystemTxs,
  findMatchingTx,
} from "../models/system-tx";
import { getAssetBySystemAddress, refreshAssetCache } from "../cache/assets";
import { parseAmount, normalizeAddress } from "../lib/utils";
import type { Transfer } from "../models/transfer";
import {
  type BlockFetcherService,
  type BlockData,
  type SystemTx,
  type BlockFetchError,
} from "../strategies/types";
import { recordBlockFetch } from "../metrics";

/** Batch size for fetches */
const BATCH_SIZE = 5;

/** Max rounds before giving up */
const MAX_ROUNDS = 20;

/** Time window to search in DB (ms) */
const DB_SEARCH_WINDOW_MS = 120_000;

/** Seed anchor for when DB is empty (block 1 genesis) */
const SEED_ANCHOR = { block: 1, time: 1739849780000 };

/** Default ms per block for extrapolation when no upper bound */
const DEFAULT_MS_PER_BLOCK = 1000;

/** Error when transaction cannot be found after exhaustive search */
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  message: string;
  blocksSearched: number;
}> {}

/** Result of successful hash finding */
export interface FindResult {
  hash: string;
  explorerHash: string;
  block: number;
  blockHash: string;
  blockTime: number;
  contractAddress: string | null;
  blocksSearched: number;
  rounds: number;
  elapsedMs: number;
}

/** Anchor point for interpolation */
interface Anchor {
  block: number;
  time: number;
}

/**
 * Interpolate block number from two anchors.
 * 
 * Simple linear interpolation.
 */
const interpolate = (
  before: Anchor,
  after: Anchor,
  targetTime: number
): number => {
  const timeDelta = after.time - before.time;
  const blockDelta = after.block - before.block;

  if (blockDelta === 0 || timeDelta === 0) {
    return before.block;
  }

  const msPerBlock = timeDelta / blockDelta;
  const targetOffset = targetTime - before.time;
  const blockOffset = Math.round(targetOffset / msPerBlock);

  return Math.max(1, before.block + blockOffset);
};

/**
 * Extrapolate block number from a single anchor using default rate.
 * 
 * Simple linear extrapolation, assuming a constant block time (DEFAULT_MS_PER_BLOCK)
 */
const extrapolate = (anchor: Anchor, targetTime: number): number => {
  const timeDiff = targetTime - anchor.time;
  const blockDiff = Math.round(timeDiff / DEFAULT_MS_PER_BLOCK);
  return Math.max(1, anchor.block + blockDiff);
};

/**
 * Check if a system transaction matches our target transfer.
 *
 * We match on all three: from (system address), assetRecipient (user), amountWei.
 * This prevents false matches when two different tokens transfer the same amount
 * to the same user around the same time.
 */
const matchesTx = (
  tx: SystemTx,
  user: string,
  systemAddress: string,
  expectedAmount: bigint
): boolean => {
  if (tx.from.toLowerCase() !== systemAddress) return false;
  if (tx.assetRecipient.toLowerCase() !== user) return false;
  return BigInt(tx.amountWei) === expectedAmount;
};

/**
 * Search blocks for a matching transaction.
 */
const searchBlocks = (
  blocks: BlockData[],
  user: string,
  systemAddress: string,
  expectedAmount: bigint
): { block: BlockData; tx: SystemTx } | null => {
  for (const block of blocks) {
    for (const tx of block.systemTxs) {
      if (matchesTx(tx, user, systemAddress, expectedAmount)) {
        return { block, tx };
      }
    }
  }
  return null;
};

/** Store blocks in MongoDB asynchronously (caching optimization, non-blocking) */
const storeBlocksBackground = (blocks: BlockData[]): void => {
  Effect.runPromise(
    storeBlocksSystemTxs(blocks).pipe(
      Effect.catchAll((e) => {
        console.warn(`Failed to store system txs: ${e.message}`);
        return Effect.void;
      })
    )
  );
};

/**
 * Find the EVM transaction hash for a HyperCore transfer.
 * Uses binary search with interpolation across MongoDB cache and block fetching.
 */
export const findEvmHash = (
  transfer: Transfer,
  fetcher: BlockFetcherService
): Effect.Effect<FindResult, NotFoundError | BlockFetchError | Error> =>
  Effect.gen(function* () {
    const startMs = Date.now();
    const targetTime = transfer.hypercoreTime;
    const user = normalizeAddress(transfer.user);
    const systemAddress = normalizeAddress(transfer.systemAddress);

    // Get EVM decimals for the token
    let asset = getAssetBySystemAddress(systemAddress);
    if (!asset) {
      yield* refreshAssetCache;
      asset = getAssetBySystemAddress(systemAddress);
    }
    const evmDecimals = asset?.evmDecimals ?? 18;
    const expectedAmount = parseAmount(transfer.amount, evmDecimals);

    // Try MongoDB cache first (allows small window before targetTime for timing differences)
    const dbMatch = yield* findMatchingTx({
      from: systemAddress,
      assetRecipient: user,
      amountWei: expectedAmount.toString(),
      minTime: targetTime - 5000, // 5s before to handle timing differences
      maxTime: targetTime + DB_SEARCH_WINDOW_MS,
    }).pipe(Effect.catchAll(() => Effect.succeed(null)));

    if (dbMatch) {
      return {
        hash: dbMatch.hash,
        explorerHash: dbMatch.explorerHash,
        block: dbMatch.blockNumber,
        blockHash: dbMatch.blockHash,
        blockTime: dbMatch.blockTimestamp,
        contractAddress: dbMatch.contractAddress ?? null,
        blocksSearched: 0,
        rounds: 0,
        elapsedMs: Date.now() - startMs,
      };
    }

    // Get initial bounds from MongoDB (fall back to defaults if unavailable)
    const initialAnchors = yield* findBracketingAnchors(targetTime).pipe(
      Effect.catchAll(() => Effect.succeed({ before: null, after: null }))
    );

    // Initialize local bounds for binary search
    let lowerBound: Anchor = initialAnchors.before
      ? {
          block: initialAnchors.before.blockNumber,
          time: initialAnchors.before.blockTimestamp,
        }
      : SEED_ANCHOR;

    let upperBound: Anchor | null = initialAnchors.after
      ? {
          block: initialAnchors.after.blockNumber,
          time: initialAnchors.after.blockTimestamp,
        }
      : null;

    let blocksSearched = 0;

    yield* Effect.logDebug(
      `Finding ${transfer.token} ${transfer.amount} to ${user.slice(0, 10)}... ` +
        `bounds: [${lowerBound.block}, ${upperBound?.block ?? "∞"}]`
    );

    for (let round = 0; round < MAX_ROUNDS; round++) {
      // Estimate target block using current bounds
      let estimate: number;
      if (upperBound) {
        estimate = interpolate(lowerBound, upperBound, targetTime);
        // Clamp estimate to be within bounds
        estimate = Math.max(
          lowerBound.block,
          Math.min(upperBound.block, estimate)
        );
      } else {
        estimate = extrapolate(lowerBound, targetTime);
      }

      // Build batch around estimate
      const halfBatch = Math.floor(BATCH_SIZE / 2);
      let batchStart = Math.max(1, estimate - halfBatch);

      // If we have upper bound, don't go past it
      if (upperBound && batchStart + BATCH_SIZE > upperBound.block) {
        batchStart = Math.max(
          lowerBound.block,
          upperBound.block - BATCH_SIZE + 1
        );
      }

      // Don't go below lower bound
      batchStart = Math.max(lowerBound.block, batchStart);

      const blockNumbers: number[] = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const blockNum = batchStart + i;
        if (upperBound && blockNum > upperBound.block) break;
        blockNumbers.push(blockNum);
      }

      if (blockNumbers.length === 0) {
        yield* Effect.logDebug(
          `Round ${round + 1}: No blocks in range, giving up`
        );
        break;
      }

      yield* Effect.logDebug(
        `Round ${round + 1}: estimate=${estimate}, fetching ${blockNumbers.length} blocks ` +
          `[${blockNumbers[0]}-${blockNumbers[blockNumbers.length - 1]}], ` +
          `bounds=[${lowerBound.block}, ${upperBound?.block ?? "∞"}]`
      );

      // Fetch blocks using the provided fetcher service
      const fetchStartMs = Date.now();
      const blocks = yield* fetcher.fetchBlocks(blockNumbers);
      yield* recordBlockFetch(Date.now() - fetchStartMs, blocks.length, fetcher.name);
      blocksSearched += blocks.length;

      // Store in background for future queries
      storeBlocksBackground(blocks);

      if (blocks.length === 0) {
        yield* Effect.logDebug(`Round ${round + 1}: No blocks returned`);
        continue;
      }

      // Search for match
      const match = searchBlocks(blocks, user, systemAddress, expectedAmount);
      if (match) {
        yield* Effect.logDebug(
          `Found match in block ${match.block.number} after ${round + 1} rounds`
        );
        return {
          hash: match.tx.hash,
          explorerHash: match.tx.explorerHash,
          block: match.block.number,
          blockHash: match.block.hash,
          blockTime: match.block.timestamp,
          contractAddress: match.tx.contractAddress,
          blocksSearched,
          rounds: round + 1,
          elapsedMs: Date.now() - startMs,
        };
      }

      // Update bounds based on fetched blocks
      // Every block is an anchor - use the tightest bounds we can find
      let newLowerBlock: BlockData | null = null;
      let newUpperBlock: BlockData | null = null;

      for (const block of blocks) {
        if (block.timestamp <= targetTime) {
          // Block is at or before target - candidate for lower bound
          if (!newLowerBlock || block.number > newLowerBlock.number) {
            newLowerBlock = block;
          }
        }
        if (block.timestamp > targetTime) {
          // Block is after target - candidate for upper bound
          if (!newUpperBlock || block.number < newUpperBlock.number) {
            newUpperBlock = block;
          }
        }
      }

      // Tighten bounds
      if (newLowerBlock && newLowerBlock.number > lowerBound.block) {
        lowerBound = {
          block: newLowerBlock.number,
          time: newLowerBlock.timestamp,
        };
      }

      if (
        newUpperBlock &&
        (!upperBound || newUpperBlock.number < upperBound.block)
      ) {
        upperBound = {
          block: newUpperBlock.number,
          time: newUpperBlock.timestamp,
        };
      }

      yield* Effect.logDebug(
        `Round ${round + 1}: bounds now [${lowerBound.block}, ${upperBound?.block ?? "∞"}]`
      );

      // Check if bounds have converged
      if (upperBound && upperBound.block <= lowerBound.block + 1) {
        // We've narrowed down to 1-2 blocks but didn't find match
        yield* Effect.logDebug(
          `Bounds converged to [${lowerBound.block}, ${upperBound.block}] but no match`
        );
        break;
      }
    }

    return yield* new NotFoundError({
      message: `Transaction not found after ${MAX_ROUNDS} rounds`,
      blocksSearched,
    });
  });
