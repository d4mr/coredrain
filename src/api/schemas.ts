/**
 * Schema definitions for the Coredrain API.
 *
 * Uses Effect Schema for type-safe request/response validation.
 */

import { Schema } from "effect";
import { TransferStatus } from "../models/transfer";

// ============================================================================
// Common Schemas
// ============================================================================

/**
 * Ethereum address schema (0x-prefixed, 40 hex chars).
 */
export const EthAddress = Schema.String.pipe(
  Schema.pattern(/^0x[a-fA-F0-9]{40}$/),
  Schema.annotations({ description: "Ethereum address" })
);

/**
 * Transaction hash schema (0x-prefixed, 64 hex chars).
 */
export const TxHash = Schema.String.pipe(
  Schema.pattern(/^0x[a-fA-F0-9]{64}$/),
  Schema.annotations({ description: "Transaction hash" })
);

/**
 * Any hash (transfer identifier - can be hypercore, hyperevm, or explorer hash).
 */
export const AnyHash = Schema.String.pipe(
  Schema.minLength(1),
  Schema.annotations({ description: "Transfer hash (hypercore, hyperevm, or explorer)" })
);

// ============================================================================
// Pagination Schemas
// ============================================================================

/**
 * Pagination query parameters.
 */
export const PaginationParams = Schema.Struct({
  limit: Schema.optional(
    Schema.NumberFromString.pipe(
      Schema.clamp(1, 500),
      Schema.annotations({ description: "Number of items per page (1-500)" })
    )
  ),
  offset: Schema.optional(
    Schema.NumberFromString.pipe(
      Schema.nonNegative(),
      Schema.annotations({ description: "Number of items to skip" })
    )
  ),
});

export type PaginationParams = typeof PaginationParams.Type;

/**
 * Pagination response metadata.
 */
export const PaginationMeta = Schema.Struct({
  total: Schema.Number.pipe(Schema.annotations({ description: "Total number of items" })),
  limit: Schema.Number.pipe(Schema.annotations({ description: "Items per page" })),
  offset: Schema.Number.pipe(Schema.annotations({ description: "Items skipped" })),
  hasMore: Schema.Boolean.pipe(Schema.annotations({ description: "More items available" })),
});

// ============================================================================
// Transfer Schemas
// ============================================================================

/**
 * Transfer status enum.
 */
export const TransferStatusSchema = Schema.Literal(
  TransferStatus.PENDING,
  TransferStatus.MATCHED,
  TransferStatus.FAILED
).pipe(Schema.annotations({ description: "Transfer matching status" }));

/**
 * Transfer filter query parameters.
 */
export const TransferFilterParams = Schema.Struct({
  status: Schema.optional(TransferStatusSchema),
  watchedAddress: Schema.optional(EthAddress),
  user: Schema.optional(EthAddress),
  token: Schema.optional(Schema.String),
  ...PaginationParams.fields,
});

export type TransferFilterParams = typeof TransferFilterParams.Type;

/**
 * Transfer response schema.
 * Matches the Transfer model from /src/models/transfer.ts
 */
export const TransferSchema = Schema.Struct({
  _id: Schema.String,
  watchedAddress: Schema.String,
  user: Schema.String,
  token: Schema.String,
  amount: Schema.String,
  fee: Schema.NullOr(Schema.String),
  nativeTokenFee: Schema.NullOr(Schema.String),
  usdcValue: Schema.NullOr(Schema.String),
  systemAddress: Schema.String,
  contractAddress: Schema.NullOr(Schema.String),
  hypercoreTime: Schema.Number,
  hypercoreHash: Schema.String,
  status: TransferStatusSchema,
  hyperevmHash: Schema.NullOr(Schema.String),
  hyperevmExplorerHash: Schema.NullOr(Schema.String),
  hyperevmBlock: Schema.NullOr(Schema.Number),
  hyperevmBlockHash: Schema.NullOr(Schema.String),
  hyperevmTime: Schema.NullOr(Schema.Number),
  failReason: Schema.NullOr(Schema.String),
  createdAt: Schema.String, // ISO string from toISOString()
  updatedAt: Schema.String, // ISO string from toISOString()
});

export type TransferResponse = typeof TransferSchema.Type;

/**
 * Paginated transfers response.
 */
export const PaginatedTransfersResponse = Schema.Struct({
  data: Schema.Array(TransferSchema),
  pagination: PaginationMeta,
});

/**
 * Single transfer response (wrapped in data for consistency).
 */
export const SingleTransferResponse = Schema.Struct({
  data: TransferSchema,
});

// ============================================================================
// Address Schemas
// ============================================================================

/**
 * Watched address response schema.
 * Matches the WatchedAddress interface from /src/services/core-indexer.ts
 */
export const WatchedAddressSchema = Schema.Struct({
  address: Schema.String, // Already normalized, may not match strict EthAddress pattern
  lastIndexedTime: Schema.Number,
  isActive: Schema.Boolean,
});

export type WatchedAddressResponse = typeof WatchedAddressSchema.Type;

/**
 * List addresses response (wrapped in data for consistency).
 */
export const AddressesListResponse = Schema.Struct({
  data: Schema.Array(WatchedAddressSchema),
});

/**
 * Add address request body.
 */
export const AddAddressRequest = Schema.Struct({
  address: EthAddress,
});

/**
 * Add address response.
 */
export const AddAddressResponse = Schema.Struct({
  success: Schema.Boolean,
  added: Schema.Boolean,
  message: Schema.String,
});

/**
 * Address action response (activate, deactivate, reset).
 */
export const AddressActionResponse = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
});

// ============================================================================
// Stats Schemas
// ============================================================================

/**
 * System statistics response.
 */
export const SystemStatsResponse = Schema.Struct({
  transfers: Schema.Struct({
    total: Schema.Number,
    pending: Schema.Number,
    matched: Schema.Number,
    failed: Schema.Number,
  }),
  addresses: Schema.Struct({
    total: Schema.Number,
    active: Schema.Number,
  }),
  blocks: Schema.Struct({
    stored: Schema.Number,
    oldestBlock: Schema.NullOr(Schema.Number),
    newestBlock: Schema.NullOr(Schema.Number),
  }),
});

// ============================================================================
// Health Schemas
// ============================================================================

/**
 * Health check response.
 */
export const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok", "degraded", "unhealthy"),
  activeAddresses: Schema.Number,
  mongoConnected: Schema.Boolean,
});

// ============================================================================
// Error Schemas
// ============================================================================

/**
 * Not found error response.
 */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  {
    resource: Schema.String,
    id: Schema.String,
  }
) {}

/**
 * Validation error response.
 */
export class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  {
    message: Schema.String,
  }
) {}

/**
 * Database error response.
 */
export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
  "DatabaseError",
  {
    message: Schema.String,
  }
) {}
