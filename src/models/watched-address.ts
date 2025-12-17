/**
 * WatchedAddress model for tracking addresses being indexed.
 *
 * Each watched address has its own indexer worker that:
 * 1. Backfills historical transfers on startup
 * 2. Polls for new transfers every 30s
 *
 * The lastIndexedTime cursor ensures we don't re-process old data.
 */

import { Effect } from "effect";
import { prop, getModelForClass, modelOptions, index } from "@typegoose/typegoose";
import { DbQueryError, IndexError, errorMessage } from "../lib/errors";

@modelOptions({
  schemaOptions: {
    collection: "watched_addresses",
  },
})
@index({ isActive: 1 }) // for finding active addresses to index
export class WatchedAddress {
  /** Address (normalized, lowercase) — also serves as _id */
  @prop({ required: true, unique: true })
  public address!: string;

  /** Last indexed timestamp in milliseconds (0 = start from beginning) */
  @prop({ default: 0 })
  public lastIndexedTime!: number;

  /** Whether this address is actively being indexed */
  @prop({ default: true })
  public isActive!: boolean;
}

export const WatchedAddressModel = getModelForClass(WatchedAddress);

// ============================================================================
// Database Operations
// ============================================================================

/** Find all active addresses */
export const findActiveAddresses = (): Effect.Effect<
  WatchedAddress[],
  DbQueryError
> =>
  Effect.tryPromise({
    try: () => WatchedAddressModel.find({ isActive: true }).lean<WatchedAddress[]>(),
    catch: (e) =>
      new DbQueryError({
        operation: "find",
        collection: "watched_addresses",
        message: errorMessage(e),
        cause: e,
      }),
  });

/** Update lastIndexedTime cursor for an address */
export const updateCursor = (
  address: string,
  lastIndexedTime: number
): Effect.Effect<void, DbQueryError> =>
  Effect.tryPromise({
    try: () =>
      WatchedAddressModel.updateOne(
        { address },
        { $set: { lastIndexedTime } }
      ),
    catch: (e) =>
      new DbQueryError({
        operation: "updateOne",
        collection: "watched_addresses",
        message: errorMessage(e),
        cause: e,
      }),
  }).pipe(Effect.asVoid);

/** Add a new address to watch (upsert, returns true if newly added) */
export const addWatchedAddress = (
  address: string
): Effect.Effect<boolean, DbQueryError> =>
  Effect.tryPromise({
    try: async () => {
      const normalized = address.toLowerCase();
      const result = await WatchedAddressModel.updateOne(
        { address: normalized },
        {
          $setOnInsert: {
            address: normalized,
            lastIndexedTime: 0,
            isActive: true,
          },
        },
        { upsert: true }
      );
      return result.upsertedCount > 0;
    },
    catch: (e) =>
      new DbQueryError({
        operation: "updateOne",
        collection: "watched_addresses",
        message: errorMessage(e),
        cause: e,
      }),
  });

/** Deactivate an address (stops indexing but keeps data) */
export const deactivateAddress = (
  address: string
): Effect.Effect<boolean, DbQueryError> =>
  Effect.tryPromise({
    try: async () => {
      const normalized = address.toLowerCase();
      const result = await WatchedAddressModel.updateOne(
        { address: normalized },
        { $set: { isActive: false } }
      );
      return result.modifiedCount > 0;
    },
    catch: (e) =>
      new DbQueryError({
        operation: "updateOne",
        collection: "watched_addresses",
        message: errorMessage(e),
        cause: e,
      }),
  });

/** Reactivate an address */
export const activateAddress = (
  address: string
): Effect.Effect<boolean, DbQueryError> =>
  Effect.tryPromise({
    try: async () => {
      const normalized = address.toLowerCase();
      const result = await WatchedAddressModel.updateOne(
        { address: normalized },
        { $set: { isActive: true } }
      );
      return result.modifiedCount > 0;
    },
    catch: (e) =>
      new DbQueryError({
        operation: "updateOne",
        collection: "watched_addresses",
        message: errorMessage(e),
        cause: e,
      }),
  });

/** Reset an address to re-index from scratch */
export const resetAddress = (
  address: string
): Effect.Effect<boolean, DbQueryError> =>
  Effect.tryPromise({
    try: async () => {
      const normalized = address.toLowerCase();
      const result = await WatchedAddressModel.updateOne(
        { address: normalized },
        { $set: { lastIndexedTime: 0, isActive: true } }
      );
      return result.modifiedCount > 0;
    },
    catch: (e) =>
      new DbQueryError({
        operation: "updateOne",
        collection: "watched_addresses",
        message: errorMessage(e),
        cause: e,
      }),
  });

/** Get all addresses (for API) */
export const getAllAddresses = (): Effect.Effect<WatchedAddress[], DbQueryError> =>
  Effect.tryPromise({
    try: () => WatchedAddressModel.find({}).lean<WatchedAddress[]>(),
    catch: (e) =>
      new DbQueryError({
        operation: "find",
        collection: "watched_addresses",
        message: errorMessage(e),
        cause: e,
      }),
  });

/** Ensure indexes on watched_addresses collection */
export const ensureWatchedAddressIndexes: Effect.Effect<void, IndexError> =
  Effect.tryPromise({
    try: () => WatchedAddressModel.syncIndexes(),
    catch: (e) =>
      new IndexError({
        collection: "watched_addresses",
        indexName: "syncIndexes",
        message: errorMessage(e),
      }),
  }).pipe(Effect.asVoid);
