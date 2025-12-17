/**
 * Typed errors for database operations using Effect's Data.TaggedError.
 *
 * With traditional try/catch, the type system doesn't track what errors a function
 * can throw. With Effect, errors become values in the type signature:
 *
 *   function insertUser(user: User): Effect<void, DuplicateKeyError | DbConnectionError>
 *
 * Data.TaggedError creates errors with a _tag discriminator field, so you can use
 * Effect.catchTag() to handle specific error types differently:
 *
 *   effect.pipe(
 *     Effect.catchTag("DuplicateKeyError", (e) => Effect.succeed(false)),
 *     Effect.catchTag("DbConnectionError", (e) => Effect.fail(e))
 *   )
 */

import { Data } from "effect";

/**
 * Thrown when a database connection fails or times out.
 * This is typically a transient error that may succeed on retry.
 */
export class DbConnectionError extends Data.TaggedError("DbConnectionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Thrown when inserting a document that violates a unique constraint (MongoDB code 11000).
 * In this indexer, duplicate key errors are often expected since we use idempotent inserts
 * and duplicates just mean "already processed". Handle gracefully, not as a failure.
 */
export class DuplicateKeyError extends Data.TaggedError("DuplicateKeyError")<{
  readonly collection: string;
  readonly key: string;
  readonly value: string;
}> {}

/**
 * Thrown when an expected document is not found.
 */
export class DocumentNotFoundError extends Data.TaggedError("DocumentNotFoundError")<{
  readonly collection: string;
  readonly query: string;
}> {}

/**
 * Thrown when a database query fails for reasons other than duplicates or not found.
 * This includes validation errors, query syntax issues, etc.
 */
export class DbQueryError extends Data.TaggedError("DbQueryError")<{
  readonly operation: string;
  readonly collection: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Thrown when an index operation fails.
 * Index errors during startup are typically fatal, the app cannot run safely without proper indexes.
 */
export class IndexError extends Data.TaggedError("IndexError")<{
  readonly collection: string;
  readonly indexName: string;
  readonly message: string;
}> {}

/**
 * Union type of all database errors.
 * Useful for functions that need to handle any DB error.
 */
export type DbError =
  | DbConnectionError
  | DuplicateKeyError
  | DocumentNotFoundError
  | DbQueryError
  | IndexError;

/**
 * Type guard: Is this a MongoDB duplicate key error (code 11000)?
 */
export const isDuplicateKeyError = (error: unknown): boolean => {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === 11000
  );
};

/**
 * Type guard: Is this a MongoDB bulk write error where ALL failures are duplicate keys?
 * Used for batch inserts where some documents may already exist.
 */
export const isBulkDuplicateKeyError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;

  // Direct duplicate key error
  if ("code" in error && error.code === 11000) return true;

  // Bulk write error, check if ALL writeErrors are duplicates
  const bulkError = error as { writeErrors?: Array<{ code: number }> };
  if (bulkError.writeErrors && bulkError.writeErrors.length > 0) {
    return bulkError.writeErrors.every((e) => e.code === 11000);
  }

  return false;
};

/**
 * Extract error message from unknown error type.
 * Handles Error instances, objects with message property, and primitives.
 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
