/**
 * Coredrain Main Entry Point.
 *
 * This file wires up the entire application. If new to Effect, please consider reading:
 *
 * Effect is like a supercharged Promise. Instead of:
 *   async function foo(): Promise<Result> { ... }
 *
 * I can write:
 *   const foo: Effect<Result, Error, Dependencies> = Effect.gen(function* () { ... })
 *
 * The three type params are:
 *   - Result: what we get on success (like Promise<T>)
 *   - Error: what errors can happen (tracked in types, unlike Promise)
 *   - Dependencies: what services this effect needs (compile-time DI)
 *
 * `yield*` is like `await` — it unwraps the Effect and gives the value,
 * or short-circuits on error (like Rust's `?` operator).
 *
 * Nothing runs until calling Effect.runPromise() or similar at the end.
 * The whole program is just a description until then.
 *
 * CONTROL FLOW OVERVIEW:
 *
 * 1. Parse log level from env
 * 2. Build `AppLive` layer (config, metrics, fetchers)
 * 3. Build `program` by composing main logic + layers + error handling
 * 4. BunRuntime.runMain(program) — actually executes everything
 *
 * Inside `program`:
 *   a. Layers are constructed (metrics server starts, configs load)
 *   b. `initialize` runs (DB connect, seed data, warm caches)
 *   c. `main` runs (fork indexer + matcher as background fibers)
 *   d. Wait forever until Ctrl+C
 *   e. On interrupt: log shutdown, disconnect DB
 */

import {
  Effect,
  Schedule,
  Duration,
  Fiber,
  Logger,
  LogLevel,
  Layer,
} from "effect";
import { BunRuntime } from "@effect/platform-bun";
import {
  AppConfig,
  AppConfigLive,
  S3ConfigLive,
  EVM_MATCHER_CONCURRENCY,
} from "./config";
import { initializeAssetCache } from "./cache/assets";
import { seedAnchorCache } from "./cache/anchors";
import {
  runIndexerService,
  seedWatchedAddresses,
  ensureWatchedAddressIndexes,
} from "./services/core-indexer";
import { runMatcherService, logStats } from "./services/evm-matcher";
import { initializeCountersFromDb } from "./metrics";
import { MetricsLive } from "./lib/metrics-layer";
import { connectDatabase, disconnectDatabase } from "./lib/database";
import { ensureTransfersIndexes, getTransferStats } from "./models/transfer";
import { ensureSystemTxIndexes } from "./models/system-tx";
import { startApiServer } from "./api/server";
import { S3FetcherLive } from "./strategies/s3";
import { RpcFetcherLive } from "./strategies/rpc";

/**
 * Startup sequence. This runs once before the main services start.
 *
 * Order is important here:
 *
 * 1. Connect to MongoDB (everything else needs it)
 * 2 Ensure indexes exist (idempotent, but essential for indexer so we don't duplicate data)
 * 3. Seed watched addresses from config
 * 4. Initialize metrics from current DB state
 * 5. Warm caches (assets, anchors)
 */
const initialize = Effect.gen(function* () {
  yield* Effect.logInfo("=== Coredrain Starting ===");

  // AppConfig is a "service". we access it via yield* and Effect provides it at runtime from the AppLive layer.
  // This utilises Effect's dependency injection, which is just a fancy way of being able to inject concrete implementations at runtime, and only requiring the abstract type at compile time.
  const config = yield* AppConfig;
  yield* connectDatabase(config.mongodb);

  // Start API server (imperative, Bun handles lifecycle)
  startApiServer();

  // Effect.all runs these in parallel (like Promise.all)
  // Each returns Effect<void, IndexError>, we unify errors with mapError. We crash and die if we error, but that is the right thing to do here.
  // (indexes are critical for the indexer so we don't duplicate data, we heavily rely on the idemonpotency it affords us)
  yield* Effect.all([
    ensureTransfersIndexes,
    ensureSystemTxIndexes,
    ensureWatchedAddressIndexes,
  ]).pipe(Effect.mapError((e) => new Error(`Failed to sync indexes: ${e}`)));
  yield* Effect.logInfo("Database indexes synced");

  yield* seedWatchedAddresses;

  // Read current counts from DB so Prometheus counters start at the right values
  const stats = yield* getTransferStats.pipe(
    // this will also crash on error. arguably metrics are not critical to the app, but not being able to query DB is a problem bigger than metrics.
    Effect.mapError(
      (e) => new Error(`Failed to get transfer stats: ${e.message}`)
    )
  );
  yield* initializeCountersFromDb(stats);

  yield* Effect.logInfo(
    `Metrics initialized for DB: ${stats.total} indexed, ${stats.matched} matched, ${stats.failed} failed`
  );

  // this loads spot assets from the HyperCore API. We use this as the source of truth for spot asset metadata, so we want to crash if it fails.
  yield* initializeAssetCache;

  // Anchor cache seed is not critical so we don't want to crash the app if it fails.
  // It just adds the latest block as an anchor point for our block time estimation (optimisation).
  yield* seedAnchorCache.pipe(
    Effect.catchAll((e) =>
      Effect.logWarning(`Failed to seed anchor cache: ${e}`)
    )
  );

  yield* Effect.logInfo("Initialization complete");
});

/**
 * Main application loop.
 *
 * After initialization, we fork the two main services as "fibers" (like
 * lightweight threads). They run concurrently forever until interrupted.
 *
 * - Indexer: watches HyperCore addresses for transfers, writes to DB
 * - Matcher: picks up pending transfers, finds HyperEVM tx hashes
 * - Stats logger: logs match rates every 5 minutes
 *
 * Fiber.joinAll waits for all fibers since they run forever. This blocks
 * until Ctrl+C sends an interrupt signal.
 *
 * These concurrency primitives are the primary reason we use Effect over raw Promises/async-await or neverthrow/fp-ts,
 * hand-rolling these would be very error prone and difficult to reason about.
 */
const main = Effect.gen(function* () {
  yield* initialize;

  yield* Effect.logInfo("Starting services...");
  yield* Effect.logInfo(
    `Core Indexer: per-address workers with 30s poll interval`
  );
  yield* Effect.logInfo(`EVM Matcher: concurrency ${EVM_MATCHER_CONCURRENCY}`);

  // Effect.fork starts a fiber (background task) and returns immediately.
  // The fiber runs concurrently with the rest of the program.
  const matcherFiber = yield* Effect.fork(Effect.asVoid(runMatcherService));
  const indexerFiber = yield* Effect.fork(Effect.asVoid(runIndexerService));

  // Stats logging every 5 minutes
  // Schedule.spaced = run, wait 5min, run, wait 5min, ...
  const statsFiber = yield* Effect.fork(
    Effect.asVoid(
      logStats.pipe(
        Effect.catchAll(() => Effect.void), // ignore errors
        Effect.repeat(Schedule.spaced(Duration.minutes(5)))
      )
    )
  );

  yield* Effect.logInfo("Services started. Press Ctrl+C to stop.");

  // Block here until all fibers complete (they won't, unless interrupted)
  yield* Fiber.joinAll([indexerFiber, matcherFiber, statsFiber]);
});

/**
 * Wrap main with shutdown hooks.
 *
 * Effect.ensuring runs the finalizer regardless of success/failure/interrupt.
 * This is where we disconnect MongoDB cleanly.
 */
const mainWithShutdown = main.pipe(
  Effect.ensuring(
    Effect.gen(function* () {
      yield* Effect.logInfo("Shutting down...");
      yield* disconnectDatabase;
    })
  )
);

/**
 * Layers are Effect's dependency injection system.
 *
 * When an Effect needs a service (like AppConfig or S3Fetcher), it declares
 * that in its type signature as the third type parameter:
 *
 *   Effect<Result, Error, AppConfig | S3Fetcher>
 *
 * Layers "provide" these services. AppConfigLive constructs the real AppConfig,
 * S3FetcherLive constructs the real S3 client, etc.
 *
 * Layer.mergeAll combines multiple layers into one. Layer.provide wires
 * dependencies between layers (S3FetcherLive needs S3ConfigLive).
 *
 * Why use layers at all?
 * - Testability: swap S3FetcherLive for a mock in tests
 * - Configuration: different layers for dev/prod
 * - Type safety: compiler ensures all dependencies are provided
 *
 * For simple startup tasks (DB connect, start server), we use imperative
 * functions instead. Layers are overkill for one-time setup that isn't
 * swapped out or tested in isolation.
 */
const AppLive = Layer.mergeAll(
  AppConfigLive, // loads config from env
  RpcFetcherLive, // HyperEVM RPC client (fallback for block fetching)
  MetricsLive, // Prometheus metrics server on :9464
  S3FetcherLive.pipe(Layer.provide(S3ConfigLive)) // S3 client for block data
);

// ============================================================================
// Run
// ============================================================================

// Parse log level from env (default: warn)
const logLevelStr = process.env.LOG_LEVEL?.toLowerCase() ?? "warn";
const logLevel =
  logLevelStr === "debug"
    ? LogLevel.Debug
    : logLevelStr === "info"
    ? LogLevel.Info
    : logLevelStr === "error"
    ? LogLevel.Error
    : LogLevel.Warning;

/**
 * Final program assembly.
 *
 * This is where we take `mainWithShutdown` (just a description of what to do)
 * and turn it into something runnable by:
 *
 * 1. Effect.scoped: provides a Scope for resource management (for proper resource cleanup on effect shutdown)
 * 2. Logger.withMinimumLogLevel: filters log output
 * 3. Effect.provide: injects all the layers (this is where services get built)
 * 4. Effect.catchAllDefect: last-resort error handler for defects (ie, we neglected to consider something might throw an error. Only happens when interfacing with external non-effect code)
 */
const program = mainWithShutdown.pipe(
  Effect.scoped,
  Logger.withMinimumLogLevel(logLevel),
  Effect.provide(Layer.merge(Logger.logFmt, AppLive)),
  Effect.catchAllDefect((defect) => {
    console.error("Fatal error:", defect);
    return Effect.fail(defect as Error);
  })
);

// This is the only imperative call. Everything above is just building up
// a description of what to do. This line actually runs it.
BunRuntime.runMain(program, { disablePrettyLogger: true });
