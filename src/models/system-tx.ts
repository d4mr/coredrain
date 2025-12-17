/**
 * SystemTransaction model for caching EVM system transactions.
 *
 * Every block we fetch from S3/RPC that has system transactions, we store them here.
 * This serves two purposes:
 * 1. Cache: Future lookups can check DB before hitting S3/RPC
 * 2. Anchors: Block timestamps enable interpolation for estimating which block
 *    contains a given HyperCore transfer
 *
 * Why is this separate from the Transfer model?
 *
 * Transfers come from HyperCore first, then we search for the matching EVM tx.
 * During that search we fetch blocks and cache ALL system txs in them, not just
 * the one we're looking for. A single block might have 10 system txs but we only
 * care about 1 for our current transfer. The other 9 still get cached for:
 *   - Future transfer matching (might match a different watched address later)
 *   - Anchor data for block timestamp interpolation
 *
 * If we unified them we'd either lose the cache/anchor benefits or end up with
 * a bunch of nullable fields, which is basically the same thing just messier.
 *
 * Effect is used here because system transaction operations are performance-critical
 * and involve tricky error handling. Batch inserts can partially fail, and we
 * intentionally allow duplicate inserts (idempotent). With Effect's typed errors,
 * we can cleanly distinguish "expected duplicate" from "real error" and compose
 * anchor queries, cache lookups, and matching operations together.
 */

import { Effect } from "effect";
import {
  prop,
  getModelForClass,
  modelOptions,
  index,
} from "@typegoose/typegoose";
import {
  DbQueryError,
  IndexError,
  isBulkDuplicateKeyError,
  errorMessage,
} from "../lib/errors";

/**
 * A single system transaction from a block.
 * Each tx also serves as an anchor point for block estimation.
 *
 * Field naming follows the SystemTx interface in strategies/types.ts:
 *   from = system address (tx.from)
 *   assetRecipient = user receiving the asset
 *   amountWei = amount in smallest units
 *
 * We don't store tx.to or tx.value directly because they mean different things
 * for HYPE vs ERC20 and would be confusing. See types.ts for the full explanation.
 */
@modelOptions({
  schemaOptions: {
    collection: "system_txs",
    timestamps: false, // we have our own timestamp
  },
})
@index({ blockNumber: 1 }) // for fetching all txs in a block
@index({ blockTimestamp: 1 }) // for anchor queries (find closest block to time)
@index({ from: 1, assetRecipient: 1, amountWei: 1 }) // for matching transfers
@index({ hash: 1 }, { unique: true }) // primary key
export class SystemTransaction {
  /** Internal Hyperliquid hash (r=0, s=0) */
  @prop({ required: true })
  public hash!: string;

  /** Explorer-compatible hash (r=1, s=from address) */
  @prop({ required: true, index: true })
  public explorerHash!: string;

  /** Block number */
  @prop({ required: true })
  public blockNumber!: number;

  /** Block hash */
  @prop({ required: true })
  public blockHash!: string;

  /** Block timestamp in milliseconds */
  @prop({ required: true })
  public blockTimestamp!: number;

  /** System address that sent the asset (tx.from). 0x2222... for HYPE, 0x2000...{assetId} for tokens */
  @prop({ required: true, index: true })
  public from!: string;

  /** User address receiving the asset */
  @prop({ required: true })
  public assetRecipient!: string;

  /** Asset amount in smallest units (wei for HYPE, token units for ERC20) */
  @prop({ required: true })
  public amountWei!: string;

  /** ERC20 contract address (null for native HYPE transfers) */
  @prop({ required: false, default: null })
  public contractAddress!: string | null;
}

export const SystemTransactionModel = getModelForClass(SystemTransaction);

/**
 * Ensure the system_txs collection indexes are created/synced.
 */
export const ensureSystemTxIndexes: Effect.Effect<void, IndexError> =
  Effect.gen(function* () {
    // Sync indexes from schema
    yield* Effect.tryPromise({
      try: () => SystemTransactionModel.syncIndexes(),
      catch: (e) =>
        new IndexError({
          collection: "system_txs",
          indexName: "schema",
          message: `Failed to sync indexes: ${e}`,
        }),
    });

    // Verify the unique index on hash was actually created
    const indexes = yield* Effect.tryPromise({
      try: () => SystemTransactionModel.collection.indexes(),
      catch: (e) =>
        new IndexError({
          collection: "system_txs",
          indexName: "verification",
          message: `Failed to list indexes: ${e}`,
        }),
    });

    const hashIndex = indexes.find(
      (idx) => idx.key && "hash" in idx.key && Object.keys(idx.key).length === 1
    );

    if (!hashIndex) {
      return yield* Effect.fail(
        new IndexError({
          collection: "system_txs",
          indexName: "hash",
          message:
            "CRITICAL: hash index not found. Check for duplicate data preventing index creation.",
        })
      );
    }

    if (!hashIndex.unique) {
      return yield* Effect.fail(
        new IndexError({
          collection: "system_txs",
          indexName: "hash",
          message:
            "CRITICAL: hash index exists but is not unique. Drop the index and remove duplicates.",
        })
      );
    }
  });

/** Input type for storing a block's system transactions */
export interface BlockSystemTxs {
  number: number;
  hash: string;
  timestamp: number;
  systemTxs: Array<{
    hash: string;
    explorerHash: string;
    from: string;
    assetRecipient: string;
    amountWei: string;
    contractAddress: string | null;
  }>;
}

/**
 * Store system transactions from a block.
 * Only stores if block has system transactions.
 * Silently succeeds on duplicates (idempotent insert).
 *
 * We may re-fetch the same blocks multiple times (retries, restarts, overlapping ranges).
 * Rather than checking "does this exist?" before every insert (slow, race-prone),
 * we just insert and let MongoDB's unique index handle duplicates.
 */
export const storeBlockSystemTxs = (
  block: BlockSystemTxs
): Effect.Effect<void, DbQueryError> =>
  Effect.gen(function* () {
    // Skip blocks with no system transactions
    if (block.systemTxs.length === 0) return;

    const docs = block.systemTxs.map((tx) => ({
      hash: tx.hash,
      explorerHash: tx.explorerHash,
      blockNumber: block.number,
      blockHash: block.hash,
      blockTimestamp: block.timestamp,
      from: tx.from.toLowerCase(),
      assetRecipient: tx.assetRecipient.toLowerCase(),
      amountWei: tx.amountWei,
      contractAddress: tx.contractAddress?.toLowerCase() ?? null,
    }));

    yield* Effect.tryPromise({
      try: () => SystemTransactionModel.insertMany(docs, { ordered: false }),
      catch: (error) => {
        // Duplicate key errors are expected and should be treated as success
        if (isBulkDuplicateKeyError(error)) {
          return null; // Sentinel for "not a real error"
        }
        return new DbQueryError({
          operation: "insertMany",
          collection: "system_txs",
          message: errorMessage(error),
          cause: error,
        });
      },
    }).pipe(
      // Convert null (duplicate) to success, propagate real errors
      Effect.flatMap((result) => (result === null ? Effect.void : Effect.void)),
      // If error is null (duplicate sentinel), succeed
      Effect.catchIf(
        (e) => e === null,
        () => Effect.void
      )
    );
  });

/**
 * Store system transactions from multiple blocks in batch.
 * Much more efficient than one-by-one, single database round-trip.
 */
export const storeBlocksSystemTxs = (
  blocks: BlockSystemTxs[]
): Effect.Effect<void, DbQueryError> =>
  Effect.gen(function* () {
    // Filter to only blocks with system txs
    const blocksWithTxs = blocks.filter((b) => b.systemTxs.length > 0);
    if (blocksWithTxs.length === 0) return;

    // Flatten all txs into a single array
    const allDocs = blocksWithTxs.flatMap((block) =>
      block.systemTxs.map((tx) => ({
        hash: tx.hash,
        explorerHash: tx.explorerHash,
        blockNumber: block.number,
        blockHash: block.hash,
        blockTimestamp: block.timestamp,
        from: tx.from.toLowerCase(),
        assetRecipient: tx.assetRecipient.toLowerCase(),
        amountWei: tx.amountWei,
        contractAddress: tx.contractAddress?.toLowerCase() ?? null,
      }))
    );

    yield* Effect.tryPromise({
      try: () => SystemTransactionModel.insertMany(allDocs, { ordered: false }),
      catch: (error) => {
        // Duplicate key errors are expected
        if (isBulkDuplicateKeyError(error)) {
          return null;
        }
        return new DbQueryError({
          operation: "insertMany",
          collection: "system_txs",
          message: errorMessage(error),
          cause: error,
        });
      },
    }).pipe(
      Effect.flatMap((result) => (result === null ? Effect.void : Effect.void)),
      Effect.catchIf(
        (e) => e === null,
        () => Effect.void
      )
    );
  });

/** Anchor point for block number interpolation */
export interface BlockAnchor {
  blockNumber: number;
  blockTimestamp: number;
}

/**
 * Find anchors bracketing a target timestamp for interpolation.
 * Returns the closest system tx before and after the target time.
 *
 * To estimate which block contains a HyperCore transfer, we need to convert
 * a timestamp to a block number. With two anchors (before and after the target time),
 * we can interpolate the block number linearly.
 */
export const findBracketingAnchors = (
  targetTime: number
): Effect.Effect<
  { before: BlockAnchor | null; after: BlockAnchor | null },
  DbQueryError
> =>
  // we do 2 separate parallel queries to find the closest tx before and after the target time
  // this is more efficient than doing a single facet query, because we need 2 different sort directions
  // any approach I found to use a single query would end up doing a scan or had some other performance penalty
  Effect.tryPromise({
    try: async () => {
      const [before, after] = await Promise.all([
        // Find closest tx before or at target time
        SystemTransactionModel.findOne({ blockTimestamp: { $lte: targetTime } })
          .sort({ blockTimestamp: -1 })
          .select({ blockNumber: 1, blockTimestamp: 1 })
          .lean(),
        // Find closest tx after target time
        SystemTransactionModel.findOne({ blockTimestamp: { $gt: targetTime } })
          .sort({ blockTimestamp: 1 })
          .select({ blockNumber: 1, blockTimestamp: 1 })
          .lean(),
      ]);

      return {
        before: before
          ? {
              blockNumber: before.blockNumber,
              blockTimestamp: before.blockTimestamp,
            }
          : null,
        after: after
          ? {
              blockNumber: after.blockNumber,
              blockTimestamp: after.blockTimestamp,
            }
          : null,
      };
    },
    catch: (error) =>
      new DbQueryError({
        operation: "findBracketingAnchors",
        collection: "system_txs",
        message: errorMessage(error),
        cause: error,
      }),
  });

/**
 * Get system transactions for specific blocks (for cache lookup).
 * Returns a map of blockNumber -> txs so we know which blocks we already
 * have cached (skip S3 fetch) and which we need to fetch.
 */
export const getCachedBlocksTxs = (
  blockNumbers: number[]
): Effect.Effect<Map<number, SystemTransaction[]>, DbQueryError> =>
  Effect.gen(function* () {
    if (blockNumbers.length === 0) return new Map();

    const txs = yield* Effect.tryPromise({
      try: () =>
        SystemTransactionModel.find({
          blockNumber: { $in: blockNumbers },
        }).lean(),
      catch: (error) =>
        new DbQueryError({
          operation: "find",
          collection: "system_txs",
          message: errorMessage(error),
          cause: error,
        }),
    });

    // Group by block number
    const result = new Map<number, SystemTransaction[]>();
    for (const tx of txs) {
      const existing = result.get(tx.blockNumber) || [];
      existing.push(tx);
      result.set(tx.blockNumber, existing);
    }

    return result;
  });

/**
 * Find a matching system transaction directly in the DB.
 * This can skip S3 entirely if we've already indexed the relevant block.
 *
 * S3 fetches are relatively slow and expensive. If we've already processed a block
 * that contains the matching transaction, we can find it instantly in MongoDB.
 * This is the "hot path" optimization for re-matching or late arrivals.
 *
 * We match on all three fields (from, assetRecipient, amountWei) to prevent false
 * matches. Without checking `from`, two different tokens transferring the same
 * amount to the same user at the same time could match incorrectly.
 */
export const findMatchingTx = (params: {
  from: string;
  assetRecipient: string;
  amountWei: string;
  minTime: number;
  maxTime: number;
}): Effect.Effect<SystemTransaction | null, DbQueryError> =>
  Effect.tryPromise({
    try: () =>
      SystemTransactionModel.findOne({
        from: params.from.toLowerCase(),
        assetRecipient: params.assetRecipient.toLowerCase(),
        amountWei: params.amountWei,
        blockTimestamp: { $gte: params.minTime, $lte: params.maxTime },
      })
        .sort({ blockTimestamp: 1 })
        .lean(),
    catch: (error) =>
      new DbQueryError({
        operation: "findOne",
        collection: "system_txs",
        message: errorMessage(error),
        cause: error,
      }),
  });

/** Statistics about cached system transaction data */
export interface SystemTxStats {
  transactions: number;
  uniqueBlocks: number;
  oldestBlock: number | null;
  newestBlock: number | null;
}

/** Get stats about cached data, useful for monitoring cache coverage */
export const getSystemTxStats: Effect.Effect<SystemTxStats, DbQueryError> =
  Effect.tryPromise({
    try: async () => {
      const [txCount, blockStats] = await Promise.all([
        SystemTransactionModel.countDocuments(),
        SystemTransactionModel.aggregate([
          {
            $group: {
              _id: null,
              uniqueBlocks: { $addToSet: "$blockNumber" },
              minBlock: { $min: "$blockNumber" },
              maxBlock: { $max: "$blockNumber" },
            },
          },
        ]),
      ]);

      const stats = blockStats[0];
      return {
        transactions: txCount,
        uniqueBlocks: stats?.uniqueBlocks?.length ?? 0,
        oldestBlock: stats?.minBlock ?? null,
        newestBlock: stats?.maxBlock ?? null,
      };
    },
    catch: (error) =>
      new DbQueryError({
        operation: "aggregate",
        collection: "system_txs",
        message: errorMessage(error),
        cause: error,
      }),
  });
