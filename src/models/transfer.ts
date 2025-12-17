/**
 * Transfer model for storing HyperCore to HyperEVM transfer correlations.
 *
 * Each transfer starts with HyperCore data and status='pending'.
 * The EVM matcher fills in HyperEVM data and updates status to 'matched' or 'failed'.
 *
 * Data flow:
 *   HyperCore API → core-indexer → Transfer (pending)
 *                                      ↓
 *                                 evm-matcher
 *                                      ↓
 *                              Transfer (matched) + EVM fields filled
 *
 * Why is this separate from SystemTransaction?
 *
 * Transfers represent "things we care about" from HyperCore (watched addresses).
 * SystemTransactions are a cache of ALL system txs we've seen on HyperEVM. During
 * the search for a matching EVM tx, we fetch blocks and cache every system tx in
 * them, not just the one we're looking for. This gives us:
 *   - Cache hits for future searches
 *   - Anchor points for block timestamp interpolation
 *
 * See system-tx.ts for more details on the separation.
 *
 * All database functions return Effect types with typed error channels. This means
 * the signature tells you exactly what can fail (DbQueryError, DuplicateKeyError, etc.)
 * and you can use catchTag() to handle specific errors differently.
 */

import { Effect } from "effect";
import { prop, getModelForClass, modelOptions, index } from "@typegoose/typegoose";
import type { Types } from "mongoose";
import {
  DbQueryError,
  DuplicateKeyError,
  IndexError,
  isDuplicateKeyError,
  errorMessage,
} from "../lib/errors";

/** Transfer matching status */
export enum TransferStatus {
  /** Awaiting EVM hash matching */
  PENDING = "pending",
  /** Successfully matched with EVM transaction */
  MATCHED = "matched",
  /** Failed to find matching EVM transaction after exhaustive search */
  FAILED = "failed",
}

@modelOptions({
  schemaOptions: {
    collection: "transfers",
    timestamps: true, // adds createdAt, updatedAt
  },
})
@index({ status: 1 }) // for querying pending transfers
@index({ systemAddress: 1 }) // for filtering by token
@index({ user: 1 }) // for querying by recipient
@index({ watchedAddress: 1 }) // for querying by source
@index({ hypercoreTime: 1 }) // for time-based queries
export class Transfer {
  // ===== Auto-added by Mongoose =====
  
  /** MongoDB document ID */
  public _id!: Types.ObjectId;
  
  /** Created timestamp (from timestamps: true) */
  public createdAt!: Date;
  
  /** Updated timestamp (from timestamps: true) */
  public updatedAt!: Date;

  // ===== HyperCore side =====

  /** HyperCore transaction hash (unique identifier) */
  @prop({ required: true, unique: true, index: true })
  public hypercoreHash!: string;

  /** HyperCore transaction timestamp in milliseconds */
  @prop({ required: true })
  public hypercoreTime!: number;

  /** Token symbol (e.g., "HYPE", "BUDDY") */
  @prop({ required: true })
  public token!: string;

  /** Raw amount string from HyperCore API (human-readable display format) */
  @prop({ required: true })
  public amount!: string;

  /** USD value at time of transfer (from API) */
  @prop({ default: null, type: () => String })
  public usdcValue!: string | null;

  /** Fee in token units */
  @prop({ default: null, type: () => String })
  public fee!: string | null;

  /** Fee in HYPE (native token) */
  @prop({ default: null, type: () => String })
  public nativeTokenFee!: string | null;

  /** Recipient address (lowercase) */
  @prop({ required: true })
  public user!: string;

  /** System address: 0x2222... for HYPE, 0x2000...{index} for spot tokens */
  @prop({ required: true })
  public systemAddress!: string;

  /** Which watched address this transfer originated from */
  @prop({ required: true })
  public watchedAddress!: string;

  /** ERC20 contract address (null for native HYPE transfers) */
  @prop({ default: null, type: () => String })
  public contractAddress!: string | null;

  // ===== HyperEVM side (null until matched) =====

  /** HyperEVM transaction hash (internal Hyperliquid hash with r=0, s=0) */
  @prop({ default: null, type: () => String })
  public hyperevmHash!: string | null;

  /** HyperEVM explorer-compatible transaction hash (r=1, s=from address) */
  @prop({ default: null, type: () => String, index: true })
  public hyperevmExplorerHash!: string | null;

  /** HyperEVM block number */
  @prop({ default: null, type: () => Number })
  public hyperevmBlock!: number | null;

  /** HyperEVM block hash */
  @prop({ default: null, type: () => String })
  public hyperevmBlockHash!: string | null;

  /** HyperEVM block timestamp in milliseconds */
  @prop({ default: null, type: () => Number })
  public hyperevmTime!: number | null;

  // ===== Status =====

  /** Current matching status */
  @prop({ required: true, type: String, enum: Object.values(TransferStatus), default: TransferStatus.PENDING })
  public status!: string;

  /** Failure reason (only set when status=FAILED) */
  @prop({ default: null, type: () => String })
  public failReason!: string | null;
}

export const TransferModel = getModelForClass(Transfer);

/**
 * Ensure the transfers collection indexes are created/synced.
 * Call this on startup, app should not continue without proper indexes.
 */
export const ensureTransfersIndexes: Effect.Effect<void, IndexError> = Effect.gen(function* () {
  // First, explicitly create the unique index before syncIndexes
  // This ensures it exists even on a fresh collection
  yield* Effect.tryPromise({
    try: () =>
      TransferModel.collection.createIndex(
        { hypercoreHash: 1 },
        { unique: true, background: false }
      ),
    catch: (e: unknown) => {
      const error = e as { code?: number; message?: string };
      // Code 11000 = duplicates exist, can't create unique index
      if (error.code === 11000) {
        return new IndexError({
          collection: "transfers",
          indexName: "hypercoreHash",
          message: "Cannot create unique index - duplicates exist. Clean up duplicates and restart.",
        });
      }
      // Code 86 = index exists with different options
      if (error.code === 86) {
        return new IndexError({
          collection: "transfers",
          indexName: "hypercoreHash",
          message: "Index exists with wrong options. Drop the index manually and restart.",
        });
      }
      // Code 85 = index already exists with same options, this is fine
      // Other codes are unexpected
      if (error.code !== 85) {
        return new IndexError({
          collection: "transfers",
          indexName: "hypercoreHash",
          message: `Unexpected error creating index: ${error.message}`,
        });
      }
      // Code 85: index exists and is correct, return a sentinel error that we'll catch
      return new IndexError({
        collection: "transfers",
        indexName: "hypercoreHash",
        message: "__INDEX_EXISTS__",
      });
    },
  }).pipe(
    // Catch the "index already exists" sentinel and convert to success
    Effect.catchIf(
      (e) => e.message === "__INDEX_EXISTS__",
      () => Effect.void
    )
  );

  // Sync the rest of the indexes from schema
  yield* Effect.tryPromise({
    try: () => TransferModel.syncIndexes(),
    catch: (e) =>
      new IndexError({
        collection: "transfers",
        indexName: "schema",
        message: `Failed to sync indexes: ${e}`,
      }),
  });

  // Verify the unique index was actually created
  const indexes = yield* Effect.tryPromise({
    try: () => TransferModel.collection.indexes(),
    catch: (e) =>
      new IndexError({
        collection: "transfers",
        indexName: "verification",
        message: `Failed to list indexes: ${e}`,
      }),
  });

  const hypercoreHashIndex = indexes.find(
    (idx) => idx.key && "hypercoreHash" in idx.key
  );

  if (!hypercoreHashIndex?.unique) {
    return yield* Effect.fail(
      new IndexError({
        collection: "transfers",
        indexName: "hypercoreHash",
        message: "Unique index verification failed after creation.",
      })
    );
  }
});

/** Input type for creating a new transfer (HyperCore side only) */
export interface NewTransfer {
  hypercoreHash: string;
  hypercoreTime: number;
  token: string;
  amount: string;
  usdcValue: string | null;
  fee: string | null;
  nativeTokenFee: string | null;
  user: string;
  systemAddress: string;
  watchedAddress: string;
  contractAddress: string | null;
}

/**
 * Insert a transfer if it doesn't already exist (by hypercoreHash).
 * Returns true if inserted, false if already exists.
 *
 * This is an idempotent insert, we can safely call it multiple times with the same
 * data. This is crucial for the indexer because we may re-process the same blocks
 * after a restart, and we want to count "new" vs "already seen" transfers separately.
 *
 * DuplicateKeyError is caught internally and converted to false. Other errors propagate.
 */
export const insertTransfer = (
  transfer: NewTransfer
): Effect.Effect<boolean, DbQueryError> =>
  Effect.tryPromise({
    try: async () => {
      await TransferModel.create({
        hypercoreHash: transfer.hypercoreHash,
        hypercoreTime: transfer.hypercoreTime,
        token: transfer.token,
        amount: transfer.amount,
        usdcValue: transfer.usdcValue,
        fee: transfer.fee,
        nativeTokenFee: transfer.nativeTokenFee,
        user: transfer.user,
        systemAddress: transfer.systemAddress,
        watchedAddress: transfer.watchedAddress,
        contractAddress: transfer.contractAddress,
        hyperevmHash: null,
        hyperevmExplorerHash: null,
        hyperevmBlock: null,
        hyperevmBlockHash: null,
        hyperevmTime: null,
        status: TransferStatus.PENDING,
        failReason: null,
      });
      return true;
    },
    catch: (error: unknown) => {
      // Duplicate key error is expected, convert to typed error
      if (isDuplicateKeyError(error)) {
        return new DuplicateKeyError({
          collection: "transfers",
          key: "hypercoreHash",
          value: transfer.hypercoreHash,
        });
      }
      // Other errors are unexpected
      return new DbQueryError({
        operation: "insert",
        collection: "transfers",
        message: errorMessage(error),
        cause: error,
      });
    },
  }).pipe(
    // Convert DuplicateKeyError to success(false), the expected "already exists" case
    Effect.catchTag("DuplicateKeyError", () => Effect.succeed(false))
  );

/** Result of a batch insert operation */
export interface BatchInsertResult {
  /** Number of new transfers inserted */
  inserted: number;
  /** Number of transfers that already existed (duplicates) */
  duplicates: number;
}

/**
 * Batch insert transfers with ordered:false for best performance.
 *
 * Uses insertMany with ordered:false so MongoDB continues inserting even when
 * some documents fail (duplicates). This is much faster than individual inserts.
 *
 * Returns count of inserted vs duplicates. Only fails on non-duplicate errors.
 */
export const insertTransfersBatch = (
  transfers: NewTransfer[]
): Effect.Effect<BatchInsertResult, DbQueryError> =>
  Effect.tryPromise({
    try: async () => {
      if (transfers.length === 0) {
        return { inserted: 0, duplicates: 0 };
      }

      const docs = transfers.map((t) => ({
        hypercoreHash: t.hypercoreHash,
        hypercoreTime: t.hypercoreTime,
        token: t.token,
        amount: t.amount,
        usdcValue: t.usdcValue,
        fee: t.fee,
        nativeTokenFee: t.nativeTokenFee,
        user: t.user,
        systemAddress: t.systemAddress,
        watchedAddress: t.watchedAddress,
        contractAddress: t.contractAddress,
        hyperevmHash: null,
        hyperevmExplorerHash: null,
        hyperevmBlock: null,
        hyperevmBlockHash: null,
        hyperevmTime: null,
        status: TransferStatus.PENDING,
        failReason: null,
      }));

      try {
        const result = await TransferModel.insertMany(docs, { ordered: false });
        return { inserted: result.length, duplicates: 0 };
      } catch (error: unknown) {
        // With ordered:false, MongoDB throws MongoBulkWriteError but still inserts non-duplicates
        // Structure: { insertedCount, writeErrors: [{ err: { code, errmsg } }] }
        const bulkError = error as {
          code?: number;
          insertedCount?: number;
          writeErrors?: Array<{ err?: { code: number } }>;
        };

        // Check if this is a duplicate key error (code 11000)
        if (bulkError.code !== 11000) {
          throw error;
        }

        const insertedCount = bulkError.insertedCount ?? 0;
        const writeErrors = bulkError.writeErrors ?? [];
        
        // Check if all write errors are duplicate key errors
        // Note: writeErrors[i].err.code, not writeErrors[i].code
        const allDuplicates = writeErrors.every((e) => e.err?.code === 11000);
        
        if (!allDuplicates) {
          // Has non-duplicate errors, re-throw
          throw error;
        }

        const duplicateCount = writeErrors.length;
        return { inserted: insertedCount, duplicates: duplicateCount };
      }
    },
    catch: (error: unknown) =>
      new DbQueryError({
        operation: "insertMany",
        collection: "transfers",
        message: errorMessage(error),
        cause: error,
      }),
  });

/** Get pending transfers for matching (oldest first, FIFO) */
export const getPendingTransfers = (
  limit: number
): Effect.Effect<Transfer[], DbQueryError> =>
  Effect.tryPromise({
    try: () =>
      TransferModel.find({ status: TransferStatus.PENDING })
        .sort({ hypercoreTime: 1 }) // oldest first
        .limit(limit)
        .lean(),
    catch: (error) =>
      new DbQueryError({
        operation: "find",
        collection: "transfers",
        message: errorMessage(error),
        cause: error,
      }),
  });

/** Mark a transfer as matched with EVM transaction details */
export const markTransferMatched = (
  hypercoreHash: string,
  evmData: {
    hyperevmHash: string;
    hyperevmExplorerHash: string;
    hyperevmBlock: number;
    hyperevmBlockHash: string;
    hyperevmTime: number;
    contractAddress: string | null;
  }
): Effect.Effect<void, DbQueryError> =>
  Effect.tryPromise({
    try: async () => {
      await TransferModel.updateOne(
        { hypercoreHash },
        {
          $set: {
            ...evmData,
            status: TransferStatus.MATCHED,
            failReason: null,
          },
        }
      );
    },
    catch: (error) =>
      new DbQueryError({
        operation: "updateOne",
        collection: "transfers",
        message: errorMessage(error),
        cause: error,
      }),
  });

/** Mark a transfer as failed with a reason */
export const markTransferFailed = (
  hypercoreHash: string,
  reason: string
): Effect.Effect<void, DbQueryError> =>
  Effect.tryPromise({
    try: async () => {
      await TransferModel.updateOne(
        { hypercoreHash },
        {
          $set: {
            status: TransferStatus.FAILED,
            failReason: reason,
          },
        }
      );
    },
    catch: (error) =>
      new DbQueryError({
        operation: "updateOne",
        collection: "transfers",
        message: errorMessage(error),
        cause: error,
      }),
  });

/** Transfer statistics by status */
export interface TransferStats {
  pending: number;
  matched: number;
  failed: number;
  total: number;
}

/**
 * Get transfer counts by status.
 *
 * NOTE: This uses aggregation which performs a collection scan, O(n) where n is total documents.
 * For production at scale, consider using estimatedDocumentCount() for totals (O(1) using
 * collection metadata) and caching status breakdowns with a TTL. The accurate counts here
 * are intentional for demo purposes where seeing real-time progress is more valuable than
 * optimal performance.
 */
export const getTransferStats: Effect.Effect<TransferStats, DbQueryError> =
  Effect.tryPromise({
    try: async () => {
      const results = await TransferModel.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);

      const stats: TransferStats = { pending: 0, matched: 0, failed: 0, total: 0 };
      for (const r of results) {
        if (r._id === TransferStatus.PENDING) stats.pending = r.count;
        else if (r._id === TransferStatus.MATCHED) stats.matched = r.count;
        else if (r._id === TransferStatus.FAILED) stats.failed = r.count;
        stats.total += r.count;
      }
      return stats;
    },
    catch: (error) =>
      new DbQueryError({
        operation: "aggregate",
        collection: "transfers",
        message: errorMessage(error),
        cause: error,
      }),
  });
