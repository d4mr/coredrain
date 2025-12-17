/**
 * MongoDB Database Connection.
 *
 * Simple imperative connect/disconnect. Mongoose handles reconnection
 * internally, so we don't need fancy lifecycle management here.
 */

import { Effect } from "effect";
import mongoose from "mongoose";

/**
 * Connect to MongoDB. Call once at startup.
 */
export const connectDatabase = (mongoUrl: string) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Connecting to MongoDB at ${mongoUrl}...`);
    yield* Effect.tryPromise({
      try: () => mongoose.connect(mongoUrl),
      catch: (e) => new Error(`MongoDB connection failed: ${e}`),
    });
    yield* Effect.logInfo("Connected to MongoDB");
  });

/**
 * Disconnect from MongoDB. Call on shutdown.
 */
export const disconnectDatabase = Effect.gen(function* () {
  yield* Effect.logInfo("Disconnecting from MongoDB...");
  yield* Effect.tryPromise({
    try: () => mongoose.disconnect(),
    catch: (e) => new Error(`MongoDB disconnect failed: ${e}`),
  }).pipe(Effect.ignore);
  yield* Effect.logInfo("Disconnected from MongoDB");
});
