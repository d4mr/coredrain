/**
 * MongoDB connection management using Effect.
 *
 * Provides a managed connection that properly handles startup and shutdown.
 * Uses mongoose with typegoose for type-safe model definitions.
 */

import { Effect, Layer, Context } from "effect";
import mongoose from "mongoose";
import { AppConfig } from "../config";

/** Database connection service tag */
export class Database extends Context.Tag("Database")<
  Database,
  { readonly connection: typeof mongoose }
>() {}

/** Error type for database operations */
export class DatabaseError {
  readonly _tag = "DatabaseError";
  constructor(
    readonly message: string,
    readonly cause?: unknown
  ) {}
}

/**
 * Connect to MongoDB.
 * Returns the mongoose instance for use with typegoose models.
 */
export const connect = (mongodbUrl: string) =>
  Effect.tryPromise({
    try: async () => {
      const conn = await mongoose.connect(mongodbUrl);
      return conn;
    },
    catch: (error) => new DatabaseError("Failed to connect to MongoDB", error),
  });

/**
 * Disconnect from MongoDB.
 */
export const disconnect = Effect.tryPromise({
  try: async () => {
    await mongoose.disconnect();
  },
  catch: (error) =>
    new DatabaseError("Failed to disconnect from MongoDB", error),
});

/**
 * Database layer that manages connection lifecycle.
 * Connects on startup, disconnects on shutdown.
 * Requires AppConfig to get MongoDB URL.
 */
export const DatabaseLive = Layer.scoped(
  Database,
  Effect.gen(function* () {
    const config = yield* AppConfig;

    yield* Effect.logInfo("Connecting to MongoDB...");
    const connection = yield* Effect.acquireRelease(
      connect(config.mongodb),
      () =>
        Effect.gen(function* () {
          yield* Effect.logInfo("Disconnecting from MongoDB...");
          yield* disconnect;
          yield* Effect.logInfo("Disconnected from MongoDB");
        }).pipe(Effect.orDie)
    );
    yield* Effect.logInfo("Connected to MongoDB");
    return { connection };
  })
);

/**
 * Helper to run an effect that requires database access.
 */
export const withDatabase = <A, E>(
  effect: Effect.Effect<A, E, Database>
): Effect.Effect<A, E | DatabaseError, AppConfig> =>
  Effect.provide(effect, DatabaseLive);
