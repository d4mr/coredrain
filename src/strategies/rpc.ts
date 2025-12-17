/**
 * RPC-based block fetcher.
 *
 * Uses HyperEVM JSON-RPC to fetch blocks and system transactions.
 * Free but slower than S3 due to batch size limits.
 * Best for: Live matching where cost matters more than speed.
 */

import { Effect, Layer, Schedule, Duration } from "effect";
import { toHex } from "viem";
import { MAX_BATCH_SIZE } from "../config";
import { RpcFetcher, BlockFetchError, type BlockData, type SystemTx } from "./types";
import { decodeTransferInput, computeExplorerHash } from "./utils";
import { errorMessage } from "../lib/errors";

const RPC_URL = "https://rpc.hyperliquid.xyz/evm";
const REQUEST_TIMEOUT_MS = 30_000;

// ============ RPC Types ============

interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface RpcBlockResponse {
  number: string;
  timestamp: string;
  hash: string;
}

interface RpcSystemTx {
  hash: string;
  from: string;
  to: string;
  input: string;
  value: string;
  nonce: string;
  gas: string;
  gasPrice: string;
  chainId: string;
}

// ============ Pure Helpers ============

/** Normalize RPC system tx to our format. Returns null for unknown tx types. */
const normalizeSystemTx = (tx: RpcSystemTx): SystemTx | null => {
  const txFrom = tx.from.toLowerCase();
  const txTo = tx.to.toLowerCase();
  const input = tx.input;

  const explorerHash = computeExplorerHash({
    chainId: BigInt(tx.chainId),
    nonce: BigInt(tx.nonce),
    gasPrice: BigInt(tx.gasPrice),
    gas: BigInt(tx.gas),
    to: txTo,
    value: BigInt(tx.value),
    input,
    from: txFrom,
  });

  // HYPE (native): value > 0, empty input
  if (tx.value !== "0x0" && input === "0x") {
    return {
      hash: tx.hash,
      explorerHash,
      from: txFrom,
      assetRecipient: txTo,
      amountWei: BigInt(tx.value).toString(),
      contractAddress: null,
    };
  }

  // ERC20: decode transfer(to, amount) from calldata
  const decoded = decodeTransferInput(input);
  if (decoded) {
    return {
      hash: tx.hash,
      explorerHash,
      from: txFrom,
      assetRecipient: decoded.to,
      amountWei: decoded.amount.toString(),
      contractAddress: txTo,
    };
  }

  return null;
};

/** Parse RPC responses into BlockData. Each block needs 2 responses (block + system txs). */
const parseRpcResults = (blockNumbers: number[], results: unknown[]): BlockData[] => {
  const blocks: BlockData[] = [];

  for (let i = 0; i < blockNumbers.length; i++) {
    const blockNum = blockNumbers[i]!;
    const blockResp = results[i * 2] as RpcBlockResponse | null;
    const txsResp = results[i * 2 + 1] as RpcSystemTx[] | null;

    if (!blockResp) continue;

    const txs = Array.isArray(txsResp) ? txsResp : [];
    blocks.push({
      number: blockNum,
      hash: blockResp.hash,
      timestamp: parseInt(blockResp.timestamp, 16) * 1000,
      systemTxs: txs.map(normalizeSystemTx).filter((tx): tx is SystemTx => tx !== null),
    });
  }

  return blocks;
};

/** Build RPC batch calls for a list of block numbers */
const buildBatchCalls = (blockNumbers: number[]): { method: string; params: unknown[] }[] =>
  blockNumbers.flatMap((n) => [
    { method: "eth_getBlockByNumber", params: [toHex(n), false] },
    { method: "eth_getSystemTxsByBlockNumber", params: [toHex(n)] },
  ]);

// ============ RPC Effect ============

/** Execute a batch RPC call */
const rpcBatch = (
  calls: { method: string; params: unknown[] }[]
): Effect.Effect<unknown[], BlockFetchError> =>
  Effect.gen(function* () {
    const body = JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", ...c, id: i })));

    const resp = yield* Effect.async<Response, BlockFetchError>((resume, signal) => {
      fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal,
      })
        .then((r) => resume(Effect.succeed(r)))
        .catch((e) => resume(Effect.fail(new BlockFetchError({ message: errorMessage(e), strategy: "rpc", cause: e }))));
    }).pipe(
      Effect.timeoutFail({
        duration: Duration.millis(REQUEST_TIMEOUT_MS),
        onTimeout: () => new BlockFetchError({ message: `Timeout after ${REQUEST_TIMEOUT_MS}ms`, strategy: "rpc" }),
      })
    );

    if (!resp.ok) {
      return yield* Effect.fail(new BlockFetchError({ message: `HTTP ${resp.status}`, strategy: "rpc" }));
    }

    const json = (yield* Effect.tryPromise({
      try: () => resp.json() as Promise<RpcResponse[]>,
      catch: (e) => new BlockFetchError({ message: `JSON parse failed: ${errorMessage(e)}`, strategy: "rpc", cause: e }),
    }));

    // Check for RPC-level errors
    for (const r of json) {
      if (r?.error) {
        const msg = r.error.code === -32005 || r.error.message?.includes("rate")
          ? "rate limited"
          : r.error.code === -32010
            ? "batch too large"
            : r.error.message;
        return yield* Effect.fail(new BlockFetchError({ message: msg, strategy: "rpc" }));
      }
    }

    return json.map((r) => r?.result);
  });

/** Fetch a chunk of blocks (within batch size limit) */
const fetchChunk = (blockNumbers: number[]): Effect.Effect<BlockData[], BlockFetchError> =>
  Effect.gen(function* () {
    const calls = buildBatchCalls(blockNumbers);
    const results = yield* rpcBatch(calls);
    return parseRpcResults(blockNumbers, results);
  });

// ============ RPC Fetcher Layer ============

const retryPolicy = Schedule.exponential(Duration.millis(500), 2).pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(3)),
  Schedule.whileInput((e: BlockFetchError) =>
    e.message.includes("rate limited") ||
    e.message.includes("Timeout") ||
    e.message.includes("HTTP 5")
  )
);

export const RpcFetcherLive = Layer.succeed(RpcFetcher, {
  name: "rpc" as const,

  fetchBlocks: (blockNumbers: number[]) =>
    Effect.gen(function* () {
      if (blockNumbers.length === 0) return [];

      // Split into chunks (2 calls per block, so half the batch size)
      const chunkSize = Math.floor(MAX_BATCH_SIZE / 2);
      const chunks: number[][] = [];
      for (let i = 0; i < blockNumbers.length; i += chunkSize) {
        chunks.push(blockNumbers.slice(i, i + chunkSize));
      }

      // Fetch chunks sequentially (RPC doesn't like parallel requests)
      const results = yield* Effect.forEach(
        chunks,
        (chunk) => fetchChunk(chunk).pipe(Effect.retry(retryPolicy)),
        { concurrency: 1 }
      );

      return results.flat().sort((a, b) => a.number - b.number);
    }),
});
