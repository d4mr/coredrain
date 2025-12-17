/**
 * Coredrain HTTP API Handlers.
 *
 * Implements the handlers for all API endpoints defined in api.ts.
 * Uses HttpApiBuilder to connect handlers to the API definition.
 */

import { HttpApiBuilder } from "@effect/platform";
import { Effect, Layer } from "effect";
import mongoose from "mongoose";

import { CoredrainApi } from "./api";
import {
  NotFoundError,
  DatabaseError,
  type TransferFilterParams,
  type TransferResponse,
} from "./schemas";
import { Transfer, TransferModel, TransferStatus } from "../models/transfer";
import { SystemTransactionModel } from "../models/system-tx";
import {
  findActiveAddresses,
  getAllAddresses,
  addWatchedAddress,
  deactivateAddress,
  activateAddress,
  resetAddress,
} from "../services/core-indexer";
import { DbQueryError, errorMessage } from "../lib/errors";

// ============================================================================
// Transform Functions
// ============================================================================

/**
 * Transform a Transfer document to API response format.
 */
const toTransferResponse = (doc: Transfer): TransferResponse => ({
  _id: String(doc._id),
  watchedAddress: doc.watchedAddress,
  user: doc.user,
  token: doc.token,
  amount: doc.amount,
  fee: doc.fee,
  nativeTokenFee: doc.nativeTokenFee,
  usdcValue: doc.usdcValue,
  systemAddress: doc.systemAddress,
  contractAddress: doc.contractAddress,
  hypercoreTime: doc.hypercoreTime,
  hypercoreHash: doc.hypercoreHash,
  status: doc.status as TransferStatus,
  hyperevmHash: doc.hyperevmHash,
  hyperevmExplorerHash: doc.hyperevmExplorerHash,
  hyperevmBlock: doc.hyperevmBlock,
  hyperevmBlockHash: doc.hyperevmBlockHash,
  hyperevmTime: doc.hyperevmTime,
  failReason: doc.failReason,
  createdAt: doc.createdAt?.toISOString() ?? new Date().toISOString(),
  updatedAt: doc.updatedAt?.toISOString() ?? new Date().toISOString(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert DbQueryError to DatabaseError for API responses.
 */
const mapDbError = (e: DbQueryError): DatabaseError =>
  new DatabaseError({ message: e.message });

/**
 * Parse pagination from URL params with defaults.
 */
const parsePagination = (params: TransferFilterParams) => ({
  limit: params.limit ?? 50,
  offset: params.offset ?? 0,
});

/**
 * Parse transfer filter from URL params.
 */
const parseFilter = (params: TransferFilterParams) => {
  const query: Record<string, unknown> = {};
  
  if (params.status) {
    query.status = params.status;
  }
  if (params.watchedAddress) {
    query.watchedAddress = params.watchedAddress.toLowerCase();
  }
  if (params.user) {
    query.user = params.user.toLowerCase();
  }
  if (params.token) {
    query.token = params.token;
  }
  
  return query;
};

// ============================================================================
// Transfers Handlers
// ============================================================================

/**
 * Transfers group handler implementation.
 */
export const TransfersHandlers = HttpApiBuilder.group(
  CoredrainApi,
  "transfers",
  (handlers) =>
    handlers
      // GET /transfers - List transfers with pagination and filtering
      .handle("list", ({ urlParams }) =>
        Effect.gen(function* () {
          const pagination = parsePagination(urlParams);
          const query = parseFilter(urlParams);

          const [data, total] = yield* Effect.all([
            Effect.tryPromise({
              try: () =>
                TransferModel.find(query)
                  .sort({ hypercoreTime: -1 })
                  .skip(pagination.offset)
                  .limit(pagination.limit)
                  .lean<Transfer[]>(),
              catch: (e) =>
                new DbQueryError({
                  operation: "find",
                  collection: "transfers",
                  message: errorMessage(e),
                  cause: e,
                }),
            }),
            Effect.tryPromise({
              try: () => TransferModel.countDocuments(query),
              catch: (e) =>
                new DbQueryError({
                  operation: "countDocuments",
                  collection: "transfers",
                  message: errorMessage(e),
                  cause: e,
                }),
            }),
          ]);

          return {
            data: data.map((d) => toTransferResponse(d)),
            pagination: {
              total,
              limit: pagination.limit,
              offset: pagination.offset,
              hasMore: pagination.offset + data.length < total,
            },
          };
        }).pipe(Effect.mapError(mapDbError))
      )

      // GET /transfers/:hash - Get transfer by hash
      .handle("getByHash", ({ path }) =>
        Effect.gen(function* () {
          const normalizedHash = path.hash.toLowerCase();

          const transfer = yield* Effect.tryPromise({
            try: () =>
              TransferModel.findOne({
                $or: [
                  { hypercoreHash: normalizedHash },
                  { hyperevmHash: normalizedHash },
                  { hyperevmExplorerHash: normalizedHash },
                ],
              }).lean<Transfer | null>(),
            catch: (e) =>
              new DbQueryError({
                operation: "findOne",
                collection: "transfers",
                message: errorMessage(e),
                cause: e,
              }),
          });

          if (!transfer) {
            return yield* Effect.fail(
              new NotFoundError({ resource: "transfer", id: path.hash })
            );
          }

          return { data: toTransferResponse(transfer) };
        }).pipe(
          Effect.mapError((e) =>
            e instanceof NotFoundError ? e : mapDbError(e as DbQueryError)
          )
        )
      )
);

// ============================================================================
// Addresses Handlers
// ============================================================================

/**
 * Addresses group handler implementation.
 */
export const AddressesHandlers = HttpApiBuilder.group(
  CoredrainApi,
  "addresses",
  (handlers) =>
    handlers
      // GET /addresses - List all addresses
      .handle("list", () =>
        getAllAddresses().pipe(
          Effect.map((addresses) => ({
            data: addresses.map((a) => ({
              address: a.address,
              lastIndexedTime: a.lastIndexedTime,
              isActive: a.isActive,
            })),
          })),
          Effect.mapError(mapDbError)
        )
      )

      // POST /addresses - Add new address
      .handle("add", ({ payload }) =>
        addWatchedAddress(payload.address).pipe(
          Effect.map((added) => ({
            success: true,
            added,
            message: added ? "Address added" : "Address already exists",
          })),
          Effect.mapError(mapDbError)
        )
      )

      // DELETE /addresses/:address - Deactivate address
      .handle("deactivate", ({ path }) =>
        deactivateAddress(path.address).pipe(
          Effect.flatMap((deactivated) =>
            deactivated
              ? Effect.succeed({ success: true, message: "Address deactivated" })
              : Effect.fail(
                  new NotFoundError({ resource: "address", id: path.address })
                )
          ),
          Effect.mapError((e) =>
            e instanceof NotFoundError ? e : mapDbError(e)
          )
        )
      )

      // POST /addresses/:address/activate - Activate address
      .handle("activate", ({ path }) =>
        activateAddress(path.address).pipe(
          Effect.flatMap((activated) =>
            activated
              ? Effect.succeed({ success: true, message: "Address activated" })
              : Effect.fail(
                  new NotFoundError({ resource: "address", id: path.address })
                )
          ),
          Effect.mapError((e) =>
            e instanceof NotFoundError ? e : mapDbError(e)
          )
        )
      )

      // POST /addresses/:address/reset - Reset address
      .handle("reset", ({ path }) =>
        resetAddress(path.address).pipe(
          Effect.flatMap((wasReset) =>
            wasReset
              ? Effect.succeed({
                  success: true,
                  message: "Address reset for re-indexing",
                })
              : Effect.fail(
                  new NotFoundError({ resource: "address", id: path.address })
                )
          ),
          Effect.mapError((e) =>
            e instanceof NotFoundError ? e : mapDbError(e)
          )
        )
      )
);

// ============================================================================
// Stats Handlers
// ============================================================================

/**
 * Stats group handler implementation.
 */
export const StatsHandlers = HttpApiBuilder.group(
  CoredrainApi,
  "stats",
  (handlers) =>
    handlers
      // GET /stats - System statistics
      .handle("stats", () =>
        Effect.gen(function* () {
          const [transfersByStatus, addressesTotal, addressesActive, blockStats] =
            yield* Effect.all([
              Effect.tryPromise({
                try: () =>
                  TransferModel.aggregate([
                    { $group: { _id: "$status", count: { $sum: 1 } } },
                  ]),
                catch: (e) =>
                  new DbQueryError({
                    operation: "aggregate",
                    collection: "transfers",
                    message: errorMessage(e),
                    cause: e,
                  }),
              }),

              Effect.tryPromise({
                try: () =>
                  mongoose.connection.db!
                    .collection("watched_addresses")
                    .countDocuments(),
                catch: (e) =>
                  new DbQueryError({
                    operation: "countDocuments",
                    collection: "watched_addresses",
                    message: errorMessage(e),
                    cause: e,
                  }),
              }),

              Effect.tryPromise({
                try: () =>
                  mongoose.connection.db!
                    .collection("watched_addresses")
                    .countDocuments({ isActive: true }),
                catch: (e) =>
                  new DbQueryError({
                    operation: "countDocuments",
                    collection: "watched_addresses",
                    message: errorMessage(e),
                    cause: e,
                  }),
              }),

              Effect.tryPromise({
                try: async () => {
                  const [count, minMax] = await Promise.all([
                    SystemTransactionModel.distinct("blockNumber").then(
                      (arr) => arr.length
                    ),
                    SystemTransactionModel.aggregate([
                      {
                        $group: {
                          _id: null,
                          min: { $min: "$blockNumber" },
                          max: { $max: "$blockNumber" },
                        },
                      },
                    ]),
                  ]);
                  return {
                    count,
                    min: minMax[0]?.min ?? null,
                    max: minMax[0]?.max ?? null,
                  };
                },
                catch: (e) =>
                  new DbQueryError({
                    operation: "aggregate",
                    collection: "system_txs",
                    message: errorMessage(e),
                    cause: e,
                  }),
              }),
            ]);

          const statusMap = new Map<string, number>();
          for (const row of transfersByStatus) {
            statusMap.set(row._id, row.count);
          }

          const pending = statusMap.get(TransferStatus.PENDING) ?? 0;
          const matched = statusMap.get(TransferStatus.MATCHED) ?? 0;
          const failed = statusMap.get(TransferStatus.FAILED) ?? 0;
          const actualTotal = pending + matched + failed;

          return {
            transfers: {
              total: actualTotal,
              pending,
              matched,
              failed,
            },
            addresses: {
              total: addressesTotal,
              active: addressesActive,
            },
            blocks: {
              stored: blockStats.count,
              oldestBlock: blockStats.min,
              newestBlock: blockStats.max,
            },
          };
        }).pipe(Effect.mapError(mapDbError))
      )

      // GET /health - Health check
      .handle("health", () =>
        findActiveAddresses().pipe(
          Effect.map((addresses) => ({
            status: "ok" as const,
            activeAddresses: addresses.length,
            mongoConnected: mongoose.connection.readyState === 1,
          })),
          Effect.mapError(mapDbError)
        )
      )
);

// ============================================================================
// Combined API Layer
// ============================================================================

/**
 * Complete API implementation layer.
 * Combines all handler groups into a single layer.
 */
export const ApiLive = HttpApiBuilder.api(CoredrainApi).pipe(
  Layer.provide(TransfersHandlers),
  Layer.provide(AddressesHandlers),
  Layer.provide(StatsHandlers)
);
