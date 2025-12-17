/**
 * HyperCore Indexer Service - FiberMap Architecture
 *
 * Each watched address runs as an independent worker fiber:
 * 1. Backfill phase: Fetch all historical data as fast as possible
 * 2. Polling phase: Check for new data every 30s
 *
 * Workers are managed by a FiberMap, synced with MongoDB every 30s.
 * This allows dynamic add/remove of addresses without restart.
 *
 * Rate limiting is reactive (429-based) rather than proactive.
 * When any worker hits a 429, ALL workers pause via shared backoff state.
 */

import { Effect, Ref, FiberMap, Duration, Random, Schedule, Data } from "effect";
import { CORE_INDEXER_POLL_MS, AppConfig } from "../config";
import {
  type LedgerUpdate,
  filterSpotTransfers,
  type SpotTransfer,
} from "../api/hypercore";
import { insertTransfersBatch } from "../models/transfer";
import {
  type WatchedAddress,
  findActiveAddresses,
  updateCursor,
  addWatchedAddress,
} from "../models/watched-address";
import { isSystemAddress, normalizeAddress } from "../lib/utils";
import { recordIndexCycle } from "../metrics";
import { DbQueryError, errorMessage } from "../lib/errors";

// Re-export for API handlers and main
export {
  type WatchedAddress,
  findActiveAddresses,
  addWatchedAddress,
  getAllAddresses,
  deactivateAddress,
  activateAddress,
  resetAddress,
  ensureWatchedAddressIndexes,
} from "../models/watched-address";

/** API error with status code */
class ApiError extends Data.TaggedError("ApiError")<{
  message: string;
  status?: number;
}> {}

/**
 * Global backoff state shared across all workers.
 * When any worker hits a 429, it triggers backoff for everyone.
 * This also prevents thundering herd when rate limited because workers all individually jitter their sleep times.
 */
const makeBackoff = Effect.gen(function* () {
  const backoffUntil = yield* Ref.make(0);

  return {
    /** Wait if we're in backoff period (with jitter) */
    wait: Effect.gen(function* () {
      const until = yield* Ref.get(backoffUntil);
      const now = Date.now();
      if (until > now) {
        const jitter = yield* Random.nextIntBetween(0, 2000);
        yield* Effect.sleep(Duration.millis(until - now + jitter));
      }
    }),

    /** Trigger backoff for all workers */
    trigger: (retryAfterMs: number) =>
      Ref.update(backoffUntil, (prev) =>
        Math.max(prev, Date.now() + retryAfterMs)
      ),
  };
});

type Backoff = Effect.Effect.Success<typeof makeBackoff>;

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Fetch ledger updates from HyperCore API.
 * Handles 429 by triggering global backoff.
 *
 * Always pass startTime (use 0 for beginning).
 * The API returns results from startTime forward, sorted ascending by time.
 *
 * Uses Effect.async to get an AbortSignal that fires on timeout/interruption,
 * so the underlying fetch is actually cancelled (not just ignored).
 */
const fetchUpdates = (
  backoff: Backoff,
  address: string,
  startTime: number
): Effect.Effect<LedgerUpdate[], ApiError> =>
  Effect.gen(function* () {
    // Wait if in backoff period
    yield* backoff.wait;

    // Effect.async gives us an AbortSignal that fires on interruption/timeout
    const res = yield* Effect.async<Response, ApiError>((resume, signal) => {
      fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "userNonFundingLedgerUpdates",
          user: address,
          startTime,
        }),
        signal,
      })
        .then((r) => resume(Effect.succeed(r)))
        .catch((e) => resume(Effect.fail(new ApiError({ message: errorMessage(e) }))));
    }).pipe(
      Effect.timeoutFail({
        duration: Duration.millis(REQUEST_TIMEOUT_MS),
        onTimeout: () => new ApiError({ message: "Request timeout" }),
      })
    );

    if (res.status === 429) {
      const retryAfter =
        parseInt(res.headers.get("Retry-After") ?? "60") * 1000;
      yield* backoff.trigger(retryAfter * 1.1);
      return yield* Effect.fail(
        new ApiError({ message: "rate limited", status: 429 })
      );
    }

    if (!res.ok) {
      return yield* Effect.fail(
        new ApiError({ message: `HTTP ${res.status}`, status: res.status })
      );
    }

    return yield* Effect.tryPromise({
      try: () => res.json() as Promise<LedgerUpdate[]>,
      catch: (e) =>
        new ApiError({
          message: `JSON parse error: ${e}`,
        }),
    });
  }).pipe(
    Effect.retry(
      Schedule.exponential(Duration.seconds(1), 2).pipe(
        Schedule.jittered,
        Schedule.intersect(Schedule.recurs(5))
      )
    )
  );



// ============================================================================
// Transfer Processing
// ============================================================================

/**
 * Filter and store transfers from a page of updates.
 * Only stores transfers TO system addresses (HyperCore -> EVM).
 *
 * Uses batch insert for better performance. Duplicates are expected on
 * restart/reprocessing — we count them separately from new inserts.
 */
const processPage = (
  address: string,
  transfers: SpotTransfer[]
): Effect.Effect<{ indexed: number; skipped: number }, DbQueryError> =>
  Effect.gen(function* () {
    // Filter to only outgoing transfers (to system addresses)
    const outgoing = transfers.filter((t) => isSystemAddress(t.destination));

    if (outgoing.length === 0) {
      return { indexed: 0, skipped: 0 };
    }

    // Batch insert — much faster than individual inserts
    const result = yield* insertTransfersBatch(
      outgoing.map((t) => ({
        hypercoreHash: t.hash,
        hypercoreTime: t.time,
        token: t.token,
        amount: t.amount,
        usdcValue: t.usdcValue,
        fee: t.fee,
        nativeTokenFee: t.nativeTokenFee,
        user: normalizeAddress(t.user),
        systemAddress: normalizeAddress(t.destination),
        watchedAddress: normalizeAddress(address),
        contractAddress: null, // Will be set when matched
      }))
    );

    return { indexed: result.inserted, skipped: result.duplicates };
  });

// ============================================================================
// Single Address Worker
// ============================================================================

/**
 * Worker for a single address. Runs forever until interrupted.
 *
 * Simple loop:
 * - Fetch updates from cursor
 * - Insert into DB (batch insert handles duplicates)
 * - If we inserted anything, loop immediately (still backfilling)
 * - If we inserted nothing, sleep 30s and retry (caught up)
 *
 * Using DB insert count as the source of truth handles all edge cases:
 * - API startTime is inclusive (re-fetches last record)
 * - Multiple records at same timestamp
 * - Restarts/reprocessing
 */
const runAddressWorker = (
  backoff: Backoff,
  address: string,
  initialCursor: number
): Effect.Effect<void, ApiError | DbQueryError> =>
  Effect.gen(function* () {
    let cursor = initialCursor;

    // `return yield*` signals this never returns — runs forever until interrupted
    return yield* Effect.forever(
      Effect.gen(function* () {
        const updates = yield* fetchUpdates(backoff, address, cursor);

        if (updates.length === 0) {
          // Brand new address with no history
          yield* Effect.sleep(Duration.millis(CORE_INDEXER_POLL_MS));
          return;
        }

        // Process transfers — DB tells us how many were actually new
        const transfers = filterSpotTransfers(updates);
        const { indexed } = yield* processPage(address, transfers);

        // Advance cursor to latest timestamp
        const maxTime = Math.max(...updates.map((u) => u.time));
        cursor = maxTime;
        yield* updateCursor(address, cursor);

        if (indexed > 0) {
          // we collected new dat this cycle, log and loop immediately (backfilling)
          yield* Effect.logDebug(`${indexed} new transfers, cursor=${cursor}`);
          yield* recordIndexCycle(indexed);
        } else {
          // Nothing new this cycle, we're caught up, poll after delay
          yield* Effect.sleep(Duration.millis(CORE_INDEXER_POLL_MS));
        }
      })
    );
  }).pipe(Effect.annotateLogs({ address: address.slice(0, 10) }));

// ============================================================================
// Main Indexer Loop
// ============================================================================

/**
 * Run the indexer service.
 * Syncs workers with MongoDB every 30s.
 */
export const runIndexerService = Effect.gen(function* () {
  const backoff = yield* makeBackoff;

  // a FiberMap allows us to manage all the fibers we will spawn. It allows us to track the individual fiber and the address it is running for.
  const workers = yield* FiberMap.make<string>();
  
  // Track running worker keys (FiberMap doesn't expose keys)
  const runningKeys = new Set<string>();

  yield* Effect.logInfo("Starting indexer service...");

  // Sync loop: reconcile workers with MongoDB state
  // `return yield*` signals this never returns — runs until interrupted
  return yield* Effect.forever(
    Effect.gen(function* () {
      const docs = yield* findActiveAddresses();
      const activeAddresses = new Set(docs.map((d) => d.address));

      // Start workers for new addresses
      for (const doc of docs) {
        if (!runningKeys.has(doc.address)) {
          yield* Effect.logInfo(
            `Starting worker for ${doc.address.slice(0, 10)}...`
          );

          // run a new fiber for the address, and pass the backoff state, the address, and the initial cursor
          yield* FiberMap.run(
            workers,
            doc.address,
            runAddressWorker(
              backoff,
              doc.address,
              doc.lastIndexedTime ?? 0
            ).pipe(
              Effect.catchAll((e) =>
                Effect.logError(`Worker error: ${e.message}`)
              )
            )
          );
          runningKeys.add(doc.address);
        }
      }

      // Stop workers for removed/deactivated addresses
      for (const address of runningKeys) {
        if (!activeAddresses.has(address)) {
          yield* Effect.logInfo(
            `Stopping worker for ${address.slice(0, 10)}...`
          );
          yield* FiberMap.remove(workers, address);
          runningKeys.delete(address);
        }
      }

      yield* Effect.sleep(Duration.seconds(30));
    })
  );
}).pipe(Effect.annotateLogs("service", "core-indexer"));

/**
 * Initialize watched addresses from config.
 * Call this once at startup to seed the collection.
 * Requires AppConfig service.
 */
export const seedWatchedAddresses: Effect.Effect<void, DbQueryError, AppConfig> =
  Effect.gen(function* () {
    const config = yield* AppConfig;

    yield* Effect.logInfo("Seeding watched addresses from config...");

    // negligible startup cost so not doing a batch insert here.
    for (const address of config.watchedAddresses) {
      const added = yield* addWatchedAddress(address);
      if (added) {
        yield* Effect.logInfo(`Added ${address.slice(0, 10)}... to watch list`);
      }
    }

    const all = yield* findActiveAddresses();
    yield* Effect.logInfo(`${all.length} addresses ready for indexing`);
  });
