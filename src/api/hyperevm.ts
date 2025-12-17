/**
 * HyperEVM RPC client using Effect with automatic retry.
 *
 * Provides access to:
 * - eth_getBlockByNumber: Block metadata
 * - eth_getSystemTxsByBlockNumber: System transactions (HyperCore → EVM)
 *
 * Supports batching to reduce RPC calls, with automatic chunking
 * to avoid "batch too large" errors. Retries automatically on rate limits.
 *
 * Usage:
 *   const { block, txs } = yield* getBlockAndSystemTxs(blockNumber)
 *   const txsMap = yield* getSystemTxsForBlocks([100, 101, 102])
 */

import { Effect, Schedule, Duration, Data } from "effect";
import { toHex } from "viem";
import { MAX_BATCH_SIZE } from "../config";

const RPC_URL = "https://rpc.hyperliquid.xyz/evm";

/** RPC error with retry information */
export class HyperevmRpcError extends Data.TaggedError("HyperevmRpcError")<{
  message: string;
  code?: number;
  retryable: boolean;
}> {}

/** RPC call structure */
interface RpcCall {
  method: string;
  params: unknown[];
}

/** RPC response structure */
interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Block response from RPC */
export interface BlockResponse {
  number: string;
  timestamp: string;
  hash: string;
}

/** System transaction from RPC */
export interface SystemTx {
  hash: string;
  from: string;
  to: string;
  input: string;
  value: string;
  blockNumber: string;
  blockHash: string;
}

/**
 * Fetch for RPC requests with retry on rate limit.
 * Handles both single and batch requests.
 */
const rpcFetch = (
  calls: RpcCall[]
): Effect.Effect<unknown[], HyperevmRpcError> =>
  Effect.gen(function* () {
    const body = JSON.stringify(
      calls.map((c, i) => ({ jsonrpc: "2.0", ...c, id: i }))
    );

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
      catch: (e) =>
        new HyperevmRpcError({
          message: `Network error: ${e}`,
          retryable: true,
        }),
    });

    if (!response.ok) {
      const isRetryable = response.status >= 500 || response.status === 429;
      return yield* Effect.fail(
        new HyperevmRpcError({
          message: `HTTP ${response.status}`,
          code: response.status,
          retryable: isRetryable,
        })
      );
    }

    const rawJson = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (e) =>
        new HyperevmRpcError({
          message: `JSON parse error: ${e}`,
          retryable: false,
        }),
    });

    // Normalize to array
    const json: RpcResponse[] = Array.isArray(rawJson) ? rawJson : [rawJson];

    // Check for rate limit errors in response body
    for (const r of json) {
      if (r?.error) {
        const isRateLimit =
          r.error.code === -32005 || r.error.message?.includes("rate");
        const isBatchTooLarge = r.error.code === -32010;

        if (isRateLimit) {
          return yield* Effect.fail(
            new HyperevmRpcError({
              message: "rate limited",
              code: r.error.code,
              retryable: true,
            })
          );
        }

        if (isBatchTooLarge) {
          return yield* Effect.fail(
            new HyperevmRpcError({
              message: "batch too large",
              code: r.error.code,
              retryable: false, // need to chunk, not retry
            })
          );
        }
      }
    }

    return json.map((r) => r?.result);
  });

/** Retry schedule: exponential backoff, max 10 retries with longer waits */
const retrySchedule = Schedule.exponential(Duration.millis(1000), 2).pipe(
  Schedule.intersect(Schedule.recurs(10)),
  Schedule.whileInput((error: HyperevmRpcError) => error.retryable)
);

/**
 * Execute a batch of RPC calls with retry on rate limit.
 */
const rpcBatch = (
  calls: RpcCall[]
): Effect.Effect<unknown[], HyperevmRpcError> =>
  rpcFetch(calls).pipe(Effect.retry(retrySchedule));

/**
 * Execute a single RPC call.
 */
const rpcCall = <T>(
  method: string,
  params: unknown[]
): Effect.Effect<T, HyperevmRpcError> =>
  rpcBatch([{ method, params }]).pipe(
    Effect.map((results) => results[0] as T)
  );

/**
 * Get block and system transactions for a block number.
 * Batches both calls into a single RPC request.
 */
export const getBlockAndSystemTxs = (
  blockNumber: number
): Effect.Effect<
  { block: BlockResponse | null; txs: SystemTx[] },
  HyperevmRpcError
> =>
  rpcBatch([
    { method: "eth_getBlockByNumber", params: [toHex(blockNumber), false] },
    { method: "eth_getSystemTxsByBlockNumber", params: [toHex(blockNumber)] },
  ]).pipe(
    Effect.map(([blockResult, txsResult]) => ({
      block: blockResult as BlockResponse | null,
      txs: (txsResult as SystemTx[]) ?? [],
    }))
  );

/**
 * Get system transactions for multiple blocks.
 * Automatically chunks to avoid "batch too large" errors.
 */
export const getSystemTxsForBlocks = (
  blockNumbers: number[]
): Effect.Effect<Map<number, SystemTx[]>, HyperevmRpcError> =>
  Effect.gen(function* () {
    const map = new Map<number, SystemTx[]>();

    // Process in chunks to avoid batch size limits
    for (let i = 0; i < blockNumbers.length; i += MAX_BATCH_SIZE) {
      const chunk = blockNumbers.slice(i, i + MAX_BATCH_SIZE);

      const results = yield* rpcBatch(
        chunk.map((n) => ({
          method: "eth_getSystemTxsByBlockNumber",
          params: [toHex(n)],
        }))
      );

      for (let j = 0; j < chunk.length; j++) {
        const blockNum = chunk[j];
        if (blockNum !== undefined) {
          map.set(blockNum, (results[j] as SystemTx[]) ?? []);
        }
      }
    }

    return map;
  });

/**
 * Get a single block's metadata.
 */
export const getBlock = (
  blockNumber: number
): Effect.Effect<BlockResponse | null, HyperevmRpcError> =>
  rpcCall<BlockResponse | null>("eth_getBlockByNumber", [
    toHex(blockNumber),
    false,
  ]);

/**
 * Get the latest block number.
 */
export const getLatestBlockNumber =
  (): Effect.Effect<number, HyperevmRpcError> =>
    rpcCall<string>("eth_blockNumber", []).pipe(
      Effect.map((hex) => parseInt(hex, 16))
    );

/** Block with parsed data and transactions */
export interface BlockWithTxs {
  number: number;
  timestamp: number; // ms
  hash: string;
  txs: SystemTx[];
}

/**
 * Get blocks with their system transactions.
 * Batches both block and tx requests together for efficiency.
 * Returns blocks sorted by block number.
 */
export const getBlocksWithTxs = (
  blockNumbers: number[]
): Effect.Effect<BlockWithTxs[], HyperevmRpcError> =>
  Effect.gen(function* () {
    if (blockNumbers.length === 0) return [];

    const results: BlockWithTxs[] = [];

    // Process in chunks to avoid batch size limits
    // Each block needs 2 calls (getBlock + getSystemTxs), so chunk size is half
    const chunkSize = Math.floor(MAX_BATCH_SIZE / 2);

    for (let i = 0; i < blockNumbers.length; i += chunkSize) {
      const chunk = blockNumbers.slice(i, i + chunkSize);

      // Build batch: for each block, request both block info and system txs
      const calls: RpcCall[] = [];
      for (const blockNum of chunk) {
        calls.push({
          method: "eth_getBlockByNumber",
          params: [toHex(blockNum), false],
        });
        calls.push({
          method: "eth_getSystemTxsByBlockNumber",
          params: [toHex(blockNum)],
        });
      }

      const batchResults = yield* rpcBatch(calls);

      // Parse results (pairs of block, txs)
      for (let j = 0; j < chunk.length; j++) {
        const blockNum = chunk[j];
        const blockResult = batchResults[j * 2] as BlockResponse | null;
        const txsResult = batchResults[j * 2 + 1] as SystemTx[] | null;

        if (blockResult && blockNum !== undefined) {
          results.push({
            number: blockNum,
            timestamp: parseInt(blockResult.timestamp, 16) * 1000,
            hash: blockResult.hash,
            txs: txsResult ?? [],
          });
        }
      }
    }

    // Sort by block number
    return results.sort((a, b) => a.number - b.number);
  });
