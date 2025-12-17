/**
 * EVM Matcher Service - Streaming Worker Pool.
 *
 * Architecture:
 * - Producer: Fetches pending transfers from DB, feeds them to a bounded queue
 * - Workers (N): Pull from queue, find EVM hash, update DB
 * - Stats Logger: Periodically logs progress
 *
 * Strategy selection: S3 for backfill (pending > 10), RPC for steady state.
 *
 * This service uses Effect's concurrency primitives heavily:
 * - Queue.bounded: Backpressure-aware work queue (workers suspend when empty, no CPU burn)
 * - Ref: Thread-safe mutable state for counters and strategy selection
 * - Fiber: Lightweight workers that can be cleanly interrupted on shutdown
 *
 * Structured concurrency means when the parent is interrupted (Ctrl+C), all child
 * fibers (workers, producer, stats logger) are automatically interrupted too.
 */

import { Effect, Queue, Fiber, Duration, Ref } from "effect";
import {
  EVM_MATCHER_CONCURRENCY,
  EVM_MATCHER_BATCH_SIZE,
  BACKFILL_THRESHOLD,
} from "../config";
import {
  getPendingTransfers,
  markTransferMatched,
  markTransferFailed,
  getTransferStats,
  type Transfer,
  type TransferStats,
} from "../models/transfer";
import { findEvmHash, NotFoundError } from "./finder";
import {
  type BlockFetcherService,
  S3Fetcher,
  RpcFetcher,
} from "../strategies/types";
import {
  recordMatch,
  recordFailed,
  recordError,
  setPendingCount,
} from "../metrics";

/** Timeout for a single transfer match attempt (ms) */
const TRANSFER_TIMEOUT_MS = 60_000;

/** How often to refill the queue when running low (ms) */
const REFILL_INTERVAL_MS = 1_000;

/** Queue low watermark - refill when below this */
const QUEUE_LOW_WATERMARK = 100;

/** Queue capacity */
const QUEUE_CAPACITY = 2048;

/** How often to log stats during streaming (ms) */
const STATS_LOG_INTERVAL_MS = 30_000;

/**
 * Process a single transfer. This willl find its EVM hash and update the database.
 *
 * Instead of erroring on failure, we return a status string. This is intentional: all error handling
 * happens internally (logging, metrics, DB updates). The caller just needs to
 * know the outcome for counting, not for error recovery.
 *
 * - "matched": Found EVM hash, DB updated to matched
 * - "failed": Exhaustive search found nothing, DB updated to failed
 * - "error": Transient error (timeout, fetch failure), left as pending for retry
 */
const processTransfer = (
  transfer: Transfer,
  fetcher: BlockFetcherService
): Effect.Effect<"matched" | "failed" | "error", never> =>
  Effect.gen(function* () {
    const startMs = Date.now();

    // Find the EVM hash with timeout
    const result = yield* findEvmHash(transfer, fetcher).pipe(
      Effect.timeout(Duration.millis(TRANSFER_TIMEOUT_MS)),
      Effect.match({
        onSuccess: (r) =>
          r
            ? { type: "success" as const, result: r }
            : { type: "timeout" as const },
        onFailure: (e) => ({ type: "error" as const, error: e }),
      })
    );

    const elapsedMs = Date.now() - startMs;

    if (result.type === "success") {
      yield* markTransferMatched(transfer.hypercoreHash, {
        hyperevmHash: result.result.hash,
        hyperevmExplorerHash: result.result.explorerHash,
        hyperevmBlock: result.result.block,
        hyperevmBlockHash: result.result.blockHash,
        hyperevmTime: result.result.blockTime,
        contractAddress: result.result.contractAddress,
      }).pipe(Effect.orDie);

      yield* recordMatch(
        result.result.elapsedMs,
        result.result.rounds,
        result.result.blocksSearched,
        fetcher.name
      );

      yield* Effect.logDebug(
        `✓ ${transfer.token} ${
          transfer.amount
        } → ${result.result.explorerHash.slice(0, 18)}... (${
          result.result.elapsedMs
        }ms, ${result.result.rounds} rounds, ${
          result.result.blocksSearched
        } blocks)`
      );

      return "matched";
    }

    if (result.type === "timeout") {
      yield* Effect.logWarning(
        `⏱ Timeout ${transfer.token} ${
          transfer.amount
        } (${transfer.hypercoreHash.slice(
          0,
          16
        )}...) after ${TRANSFER_TIMEOUT_MS}ms`
      );
      yield* recordError(fetcher.name);
      return "error";
    }

    // Handle errors, use _tag for Effect tagged errors
    const error = result.error;

    if ("_tag" in error && error._tag === "NotFoundError") {
      // Definitively not found after exhaustive search - mark as failed
      const notFound = error as NotFoundError;
      yield* markTransferFailed(
        transfer.hypercoreHash,
        `Not found after searching ${notFound.blocksSearched} blocks`
      ).pipe(Effect.orDie);

      yield* recordFailed(elapsedMs, 15, notFound.blocksSearched, fetcher.name);

      yield* Effect.logWarning(
        `✗ Failed ${transfer.token} ${transfer.amount}: ${notFound.message} (${elapsedMs}ms)`
      );

      return "failed";
    }

    // Other errors (BlockFetchError, Error) leave as pending for retry
    const errorMessage = error.message;
    yield* recordError(fetcher.name);

    yield* Effect.logError(
      `! Error ${transfer.token} ${
        transfer.amount
      } (${transfer.hypercoreHash.slice(
        0,
        16
      )}...): ${errorMessage} (${elapsedMs}ms)`
    );

    return "error";
  });

/**
 * Worker that continuously pulls from the queue and processes transfers
 * Uses fetcherRef to dynamically switch between S3 and RPC fetchers based on pending transfer count.
 * This was the reason we build the fetcher as a service, so we can easily swap out the implementation.
 * its (hopefully) worth the complexiy cost.
 */
const worker = (
  id: number,
  queue: Queue.Queue<Transfer>,
  fetcherRef: Ref.Ref<BlockFetcherService>,
  queuedHashesRef: Ref.Ref<Set<string>>,
  counters: {
    matched: Ref.Ref<number>;
    failed: Ref.Ref<number>;
    errors: Ref.Ref<number>;
  }
): Effect.Effect<never, never> =>
  Effect.forever(
    Effect.gen(function* () {
      // Take from queue (suspends if empty — no CPU burn)
      const transfer = yield* Queue.take(queue);

      // Get current fetcher strategy (may have changed)
      const fetcher = yield* Ref.get(fetcherRef);

      // Process the transfer
      const result = yield* processTransfer(transfer, fetcher);

      // Update counters atomically
      if (result === "matched") {
        yield* Ref.update(counters.matched, (n) => n + 1);
      } else if (result === "failed") {
        yield* Ref.update(counters.failed, (n) => n + 1);
      } else {
        // Error — remove from queuedHashes so it can be retried
        yield* Ref.update(queuedHashesRef, (set) => {
          const newSet = new Set(set);
          newSet.delete(transfer.hypercoreHash);
          return newSet;
        });
        yield* Ref.update(counters.errors, (n) => n + 1);
      }
    })
  ).pipe(Effect.annotateLogs("worker", String(id)));

/** Producer that fetches pending transfers and feeds them to the queue */
const producer = (
  queue: Queue.Queue<Transfer>,
  fetcherRef: Ref.Ref<BlockFetcherService>,
  queuedHashesRef: Ref.Ref<Set<string>>,
  s3Fetcher: BlockFetcherService,
  rpcFetcher: BlockFetcherService
): Effect.Effect<never, never> =>
  Effect.forever(
    Effect.gen(function* () {
      // Check queue size
      const queueSize = yield* Queue.size(queue);

      if (queueSize < QUEUE_LOW_WATERMARK) {
        // Get stats and update strategy
        const stats = yield* getTransferStats.pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              pending: 0,
              matched: 0,
              failed: 0,
              total: 0,
            } as TransferStats)
          )
        );

        yield* setPendingCount(stats.pending);

        // Select strategy based on pending count
        const isBackfill = stats.pending > BACKFILL_THRESHOLD;
        const newFetcher = isBackfill ? s3Fetcher : rpcFetcher;
        yield* Ref.set(fetcherRef, newFetcher);

        if (stats.pending > 0) {
          // Fetch a batch of pending transfers
          const batchSize = Math.min(
            QUEUE_CAPACITY - queueSize,
            EVM_MATCHER_BATCH_SIZE
          );

          const pending = yield* getPendingTransfers(batchSize).pipe(
            Effect.catchAll(() => Effect.succeed([] as Transfer[]))
          );

          // Get current queued hashes
          const queuedHashes = yield* Ref.get(queuedHashesRef);

          // Filter out already queued transfers and add to queue
          let added = 0;
          const newHashes: string[] = [];
          for (const transfer of pending) {
            if (!queuedHashes.has(transfer.hypercoreHash)) {
              newHashes.push(transfer.hypercoreHash);
              yield* Queue.offer(queue, transfer);
              added++;
            }
          }

          // Add new hashes to the set
          if (newHashes.length > 0) {
            yield* Ref.update(queuedHashesRef, (set) => {
              const newSet = new Set(set);
              for (const h of newHashes) {
                newSet.add(h);
              }
              // Clean up if too large (keep last 5k)
              if (newSet.size > 10000) {
                const entries = Array.from(newSet);
                return new Set(entries.slice(-5000));
              }
              return newSet;
            });
          }

          if (added > 0) {
            yield* Effect.logDebug(
              `Producer: added ${added} transfers to queue (size: ${
                queueSize + added
              })`
            );
          }
        }
      }

      // Sleep before next check
      yield* Effect.sleep(Duration.millis(REFILL_INTERVAL_MS));
    })
  ).pipe(Effect.annotateLogs("role", "producer"));

/**
 * Stats logger that periodically logs progress.
 *
 * Uses Ref to track lastMatched/lastTime across iterations since
 * Effect.forever creates a fresh scope each time.
 */
const statsLogger = (
  counters: {
    matched: Ref.Ref<number>;
    failed: Ref.Ref<number>;
    errors: Ref.Ref<number>;
  },
  startTime: number
): Effect.Effect<never, never> =>
  Effect.gen(function* () {
    const lastMatchedRef = yield* Ref.make(0);
    const lastTimeRef = yield* Ref.make(startTime);

    return yield* Effect.forever(
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(STATS_LOG_INTERVAL_MS));

        const matched = yield* Ref.get(counters.matched);
        const failed = yield* Ref.get(counters.failed);
        const errors = yield* Ref.get(counters.errors);
        const lastMatched = yield* Ref.get(lastMatchedRef);
        const lastTime = yield* Ref.get(lastTimeRef);

        const now = Date.now();
        const elapsed = (now - startTime) / 1000;
        const recentElapsed = (now - lastTime) / 1000;
        const recentMatched = matched - lastMatched;

        const overallRate = elapsed > 0 ? matched / elapsed : 0;
        const recentRate =
          recentElapsed > 0 ? recentMatched / recentElapsed : 0;

        // Get current pending count
        const stats = yield* getTransferStats.pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              pending: 0,
              matched: 0,
              failed: 0,
              total: 0,
            } as TransferStats)
          )
        );

        yield* Effect.logInfo(
          `Stats: ${matched} matched, ${failed} failed, ${errors} errors | ` +
            `Rate: ${recentRate.toFixed(1)}/s recent, ${overallRate.toFixed(
              1
            )}/s overall | ` +
            `Pending: ${stats.pending}`
        );

        yield* Ref.set(lastMatchedRef, matched);
        yield* Ref.set(lastTimeRef, now);
      })
    );
  }).pipe(Effect.annotateLogs("role", "stats"));

/** Run the matcher as a streaming worker pool with S3Fetcher and RpcFetcher */
export const runMatcherService: Effect.Effect<
  void,
  never,
  S3Fetcher | RpcFetcher
> = Effect.gen(function* () {
  yield* Effect.logInfo(
    `Starting streaming matcher with ${EVM_MATCHER_CONCURRENCY} workers...`
  );

  // Get fetcher services from context
  const s3Fetcher = yield* S3Fetcher;
  const rpcFetcher = yield* RpcFetcher;

  // Create bounded queue. Workers block when empty, producer blocks when full
  const queue = yield* Queue.bounded<Transfer>(QUEUE_CAPACITY);

  // Create fetcher ref (starts with S3, will be updated by producer)
  const fetcherRef = yield* Ref.make<BlockFetcherService>(s3Fetcher);

  // Track queued hashes (shared between producer and workers for retry logic)
  const queuedHashesRef = yield* Ref.make<Set<string>>(new Set());

  // Create counters for stats
  const counters = {
    matched: yield* Ref.make(0),
    failed: yield* Ref.make(0),
    errors: yield* Ref.make(0),
  };

  const startTime = Date.now();

  // Start workers as fibers
  const workerFibers: Fiber.RuntimeFiber<void, never>[] = [];
  for (let i = 0; i < EVM_MATCHER_CONCURRENCY; i++) {
    const fiber = yield* Effect.fork(
      worker(i, queue, fetcherRef, queuedHashesRef, counters)
    );
    workerFibers.push(fiber);
  }

  yield* Effect.logInfo(`Started ${workerFibers.length} workers`);

  // Start producer (runs in background)
  yield* Effect.fork(
    producer(queue, fetcherRef, queuedHashesRef, s3Fetcher, rpcFetcher)
  );

  // Start stats logger (runs in background)
  yield* Effect.fork(statsLogger(counters, startTime));

  // Wait forever (fibers run in infinite loops, interrupted on shutdown)
  // yield*ing never signals this never returns
  return yield* Effect.never;
}).pipe(Effect.annotateLogs("service", "evm-matcher"));

/**
 * Log current transfer statistics.
 */
export const logStats = Effect.gen(function* () {
  const stats = yield* getTransferStats.pipe(
    Effect.mapError((e) => new Error(`Failed to get stats: ${e.message}`))
  );

  yield* setPendingCount(stats.pending);

  yield* Effect.logInfo(
    `Transfer stats: ${stats.total} total, ${stats.matched} matched, ${stats.pending} pending, ${stats.failed} failed`
  );
});

/**
 * Run a single match cycle (for initial sync compatibility).
 */
export const runMatchCycle = Effect.gen(function* () {
  const stats = yield* getTransferStats.pipe(
    Effect.mapError(
      (e) => new Error(`Failed to get transfer stats: ${e.message}`)
    )
  );
  yield* setPendingCount(stats.pending);
  return 0;
});
