/**
 * Block anchor cache for timestamp <-> block number estimation.
 * Uses system_txs collection as anchor source for interpolation.
 */

import { Effect } from "effect";
import { getLatestBlockNumber, getBlock } from "../api/hyperevm";
import {
  findBracketingAnchors,
  storeBlockSystemTxs,
} from "../models/system-tx";
import type { DbQueryError } from "../lib/errors";

/** Seed anchor, approximate chain genesis (used when DB is empty) */
const SEED_ANCHOR = { block: 1, time: 1739849780000 };

/** Default ms per block assumption for extrapolation */
const DEFAULT_MS_PER_BLOCK = 1000;

/**
 * Estimate block number for a target timestamp using DB anchors.
 * Interpolates between bracketing anchors, or extrapolates from closest.
 */
export const estimateBlock = (
  targetTime: number
): Effect.Effect<{ block: number; msPerBlock: number }, DbQueryError> =>
  Effect.gen(function* () {
    // Query MongoDB for bracketing anchors
    const { before, after } = yield* findBracketingAnchors(targetTime);

    // If we have both, interpolate
    if (before && after && before.blockNumber !== after.blockNumber) {
      const timeDelta = after.blockTimestamp - before.blockTimestamp;
      const blockDelta = after.blockNumber - before.blockNumber;
      const msPerBlock = timeDelta / blockDelta;

      const targetOffset = targetTime - before.blockTimestamp;
      const blockOffset = Math.round(targetOffset / msPerBlock);
      const block = before.blockNumber + blockOffset;

      return { block: Math.max(1, block), msPerBlock };
    }

    // Otherwise extrapolate from closest anchor (or seed if none)
    const closest = before || after;
    if (closest) {
      const timeDiff = targetTime - closest.blockTimestamp;
      const blockDiff = Math.round(timeDiff / DEFAULT_MS_PER_BLOCK);
      const block = closest.blockNumber + blockDiff;
      return { block: Math.max(1, block), msPerBlock: DEFAULT_MS_PER_BLOCK };
    }

    // No anchors in DB, use seed anchor
    const timeDiff = targetTime - SEED_ANCHOR.time;
    const blockDiff = Math.round(timeDiff / DEFAULT_MS_PER_BLOCK);
    const block = SEED_ANCHOR.block + blockDiff;
    return { block: Math.max(1, block), msPerBlock: DEFAULT_MS_PER_BLOCK };
  });

/** Promise wrapper for non-Effect callers. Falls back to seed anchor on error. */
export const estimateBlockAsync = async (
  targetTime: number
): Promise<{ block: number; msPerBlock: number }> => {
  return Effect.runPromise(
    estimateBlock(targetTime).pipe(
      // Fallback to seed anchor on DB error
      Effect.catchAll(() =>
        Effect.succeed({
          block: Math.max(
            1,
            SEED_ANCHOR.block +
              Math.round((targetTime - SEED_ANCHOR.time) / DEFAULT_MS_PER_BLOCK)
          ),
          msPerBlock: DEFAULT_MS_PER_BLOCK,
        })
      )
    )
  );
};

/**
 * Seed cache with current block at startup for better initial estimation.
 * Creates a synthetic system tx entry as an anchor point.
 */
export const seedAnchorCache = Effect.gen(function* () {
  yield* Effect.logInfo("Seeding anchor cache with current block...");

  const latestBlockNum = yield* getLatestBlockNumber();
  const latestBlock = yield* getBlock(latestBlockNum);

  if (latestBlock) {
    const timestamp = parseInt(latestBlock.timestamp, 16) * 1000;

    yield* storeBlockSystemTxs({
      number: latestBlockNum,
      hash: latestBlock.hash,
      timestamp,
      systemTxs: [
        {
          hash: `seed-anchor-${latestBlockNum}`,
          explorerHash: `seed-anchor-explorer-${latestBlockNum}`,
          from: "0x0000000000000000000000000000000000000000",
          assetRecipient: "0x0000000000000000000000000000000000000000",
          amountWei: "0",
          contractAddress: null,
        },
      ],
    }).pipe(
      Effect.mapError((e) => new Error(`Failed to store seed anchor: ${e.message}`))
    );

    yield* Effect.logInfo(
      `Anchor cache seeded: block ${latestBlockNum} at ${new Date(timestamp).toISOString()}`
    );
  } else {
    yield* Effect.logWarning(
      `Could not fetch block ${latestBlockNum} for anchor seeding`
    );
  }
});
