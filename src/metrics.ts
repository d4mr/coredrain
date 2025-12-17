/**
 * Effect Metrics instrumentation.
 *
 * Uses Effect's built-in Metric module for type-safe, composable metrics.
 * Metrics are exposed via OpenTelemetry and can be scraped by Prometheus.
 *
 * Metrics:
 * - coredrain_transfers_processed_total (counter): Total transfers by status/strategy
 * - coredrain_transfers_pending (gauge): Current pending count
 * - coredrain_match_duration_seconds (histogram): Time to match a transfer
 * - coredrain_match_rounds (histogram): Navigation rounds per match
 * - coredrain_match_blocks_searched (histogram): Blocks searched per match
 * - coredrain_block_fetch_duration_seconds (histogram): Block fetch latency
 * - coredrain_block_fetch_count (histogram): Blocks fetched per batch
 * - coredrain_index_cycles_total (counter): Total indexer cycles
 * - coredrain_transfers_indexed_total (counter): Total transfers indexed
 * - coredrain_anchor_cache_size (gauge): Number of anchors in cache
 */

import { Effect, Metric, MetricBoundaries } from "effect";

// ============================================================================
// Metric Definitions
// ============================================================================

/**
 * Counter for total transfers processed by status and strategy.
 * Labels: status (matched, failed, error), strategy (s3, rpc)
 */
export const TransfersProcessed = Metric.counter("coredrain_transfers_processed_total");

/**
 * Tagged version of transfers processed counter.
 */
export const transfersProcessedWithTags = (status: string, strategy: string) =>
  TransfersProcessed.pipe(
    Metric.tagged("status", status),
    Metric.tagged("strategy", strategy)
  );

/**
 * Gauge for current pending transfers.
 */
export const TransfersPending = Metric.gauge("coredrain_transfers_pending");

/**
 * Histogram for match duration in seconds.
 * Buckets: 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100 seconds
 */
export const MatchDuration = Metric.histogram(
  "coredrain_match_duration_seconds",
  MetricBoundaries.exponential({ start: 0.1, factor: 2, count: 10 }),
  "Time to match a transfer in seconds"
);

/**
 * Tagged version of match duration histogram.
 */
export const matchDurationWithTags = (strategy: string) =>
  MatchDuration.pipe(Metric.tagged("strategy", strategy));

/**
 * Histogram for navigation rounds per match.
 * Buckets: 1-15 rounds
 */
export const MatchRounds = Metric.histogram(
  "coredrain_match_rounds",
  MetricBoundaries.linear({ start: 1, width: 1, count: 15 }),
  "Navigation rounds per match attempt"
);

/**
 * Tagged version of match rounds histogram.
 */
export const matchRoundsWithTags = (strategy: string, status: string) =>
  MatchRounds.pipe(
    Metric.tagged("strategy", strategy),
    Metric.tagged("status", status)
  );

/**
 * Histogram for blocks searched per match.
 * Buckets: exponential from 10 to 10000
 */
export const MatchBlocksSearched = Metric.histogram(
  "coredrain_match_blocks_searched",
  MetricBoundaries.exponential({ start: 10, factor: 2, count: 10 }),
  "Blocks searched per match attempt"
);

/**
 * Tagged version of match blocks searched histogram.
 */
export const matchBlocksSearchedWithTags = (strategy: string, status: string) =>
  MatchBlocksSearched.pipe(
    Metric.tagged("strategy", strategy),
    Metric.tagged("status", status)
  );

/**
 * Histogram for block fetch duration in seconds.
 * Buckets: exponential from 0.01 seconds
 */
export const BlockFetchDuration = Metric.histogram(
  "coredrain_block_fetch_duration_seconds",
  MetricBoundaries.exponential({ start: 0.01, factor: 2.5, count: 10 }),
  "Block fetch latency in seconds"
);

/**
 * Tagged version of block fetch duration histogram.
 */
export const blockFetchDurationWithTags = (strategy: string) =>
  BlockFetchDuration.pipe(Metric.tagged("strategy", strategy));

/**
 * Histogram for blocks fetched per batch.
 * Buckets: 1, 2, 4, 8, 16, 32, 64
 */
export const BlockFetchCount = Metric.histogram(
  "coredrain_block_fetch_count",
  MetricBoundaries.exponential({ start: 1, factor: 2, count: 7 }),
  "Blocks fetched per batch"
);

/**
 * Tagged version of block fetch count histogram.
 */
export const blockFetchCountWithTags = (strategy: string) =>
  BlockFetchCount.pipe(Metric.tagged("strategy", strategy));

/**
 * Counter for indexer cycles completed.
 */
export const IndexCycles = Metric.counter("coredrain_index_cycles_total", {
  incremental: true,
});

/**
 * Counter for new transfers indexed.
 */
export const TransfersIndexed = Metric.counter("coredrain_transfers_indexed_total", {
  incremental: true,
});

/**
 * Gauge for anchor cache size.
 */
export const AnchorCacheSize = Metric.gauge("coredrain_anchor_cache_size");

// ============================================================================
// Helper Effects for Recording Metrics
// ============================================================================

/**
 * Record a successful match with all metrics.
 * Returns an Effect that updates all relevant metrics.
 */
export const recordMatch = (
  durationMs: number,
  rounds: number,
  blocksSearched: number,
  strategy: string
): Effect.Effect<void> =>
  Effect.all([
    Metric.increment(transfersProcessedWithTags("matched", strategy)),
    Metric.update(matchDurationWithTags(strategy), durationMs / 1000),
    Metric.update(matchRoundsWithTags(strategy, "matched"), rounds),
    Metric.update(matchBlocksSearchedWithTags(strategy, "matched"), blocksSearched),
  ]).pipe(Effect.asVoid);

/**
 * Record a failed match.
 * Returns an Effect that updates all relevant metrics.
 */
export const recordFailed = (
  durationMs: number,
  rounds: number,
  blocksSearched: number,
  strategy: string
): Effect.Effect<void> =>
  Effect.all([
    Metric.increment(transfersProcessedWithTags("failed", strategy)),
    Metric.update(matchDurationWithTags(strategy), durationMs / 1000),
    Metric.update(matchRoundsWithTags(strategy, "failed"), rounds),
    Metric.update(matchBlocksSearchedWithTags(strategy, "failed"), blocksSearched),
  ]).pipe(Effect.asVoid);

/**
 * Record a match error (will be retried).
 * Returns an Effect that increments the error counter.
 */
export const recordError = (strategy: string): Effect.Effect<void> =>
  Metric.increment(transfersProcessedWithTags("error", strategy));

/**
 * Record a block fetch operation.
 * Returns an Effect that updates fetch duration and count.
 */
export const recordBlockFetch = (
  durationMs: number,
  blockCount: number,
  strategy: string
): Effect.Effect<void> =>
  Effect.all([
    Metric.update(blockFetchDurationWithTags(strategy), durationMs / 1000),
    Metric.update(blockFetchCountWithTags(strategy), blockCount),
  ]).pipe(Effect.asVoid);

/**
 * Update pending transfer count.
 * Returns an Effect that sets the gauge value.
 */
export const setPendingCount = (count: number): Effect.Effect<void> =>
  Metric.set(TransfersPending, count);

/**
 * Record index cycle completion.
 * Returns an Effect that increments cycle counter and indexed transfers.
 */
export const recordIndexCycle = (newTransfers: number): Effect.Effect<void> =>
  Effect.all([
    Metric.increment(IndexCycles),
    newTransfers > 0
      ? Metric.incrementBy(TransfersIndexed, newTransfers)
      : Effect.void,
  ]).pipe(Effect.asVoid);

/**
 * Update anchor cache size.
 * Returns an Effect that sets the gauge value.
 */
export const setAnchorCacheSize = (size: number): Effect.Effect<void> =>
  Metric.set(AnchorCacheSize, size);

/**
 * Initialize counters from database values.
 * Call this on startup to ensure metrics reflect actual DB state.
 * Returns an Effect that sets initial counter values.
 */
export const initializeCountersFromDb = (stats: {
  matched: number;
  failed: number;
  total: number;
}): Effect.Effect<void> =>
  Effect.all([
    Metric.incrementBy(transfersProcessedWithTags("matched", "s3"), stats.matched),
    Metric.incrementBy(transfersProcessedWithTags("failed", "s3"), stats.failed),
    Metric.incrementBy(TransfersIndexed, stats.total),
  ]).pipe(Effect.asVoid);
