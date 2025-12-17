/**
 * S3-based block fetcher using AWS SignatureV4 + Bun's native fetch.
 *
 * Uses Hyperliquid's S3 bucket (requester pays) to fetch blocks and system transactions.
 * Direct signed requests instead of AWS SDK for better perf (~370+ blocks/sec).
 *
 * S3 bucket structure:
 *   s3://hl-mainnet-evm-blocks/{million}/{thousand}/{blockNum}.rmp.lz4
 *   Folder N contains blocks N+1 to N+1000 (e.g., folder 5572000 has 5572001-5573000)
 *
 * Data format: LZ4 compressed MessagePack containing block header, txs, receipts, system_txs
 */

import { Effect, Layer, Schedule, Duration } from "effect";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { decompressFrameSync } from "lz4-napi";
import { unpack } from "msgpackr";
import { S3Config, S3_BUCKET, S3_REGION, HYPE_SYSTEM_ADDRESS } from "../config";
import { S3Fetcher, BlockFetchError, type BlockData, type SystemTx } from "./types";
import { decodeTransferInput, computeTxHashes, TRANSFER_EVENT_TOPIC } from "./utils";
import { errorMessage } from "../lib/errors";

const S3_HOSTNAME = `${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;
const REQUEST_TIMEOUT_MS = 30_000;

// ============ Msgpack Data Types ============

/** Buffer-like from msgpack (can be object with data array, Buffer, or Uint8Array) */
type BufLike = { type: string; data: number[] } | Buffer | Uint8Array;

const toHex = (buf: BufLike): `0x${string}` => {
  const bytes = "data" in buf ? Buffer.from(buf.data) : Buffer.from(buf);
  return `0x${bytes.toString("hex")}`;
};

const toBigInt = (buf: BufLike): bigint => BigInt(toHex(buf));

/** Raw S3 block data structure (matches msgpack schema) */
interface S3BlockData {
  block: {
    Reth115: {
      header: { hash: BufLike; header: { timestamp: BufLike } };
    };
  };
  system_txs: Array<{
    tx: {
      Legacy?: {
        chainId: BufLike;
        nonce: BufLike;
        gasPrice: BufLike;
        gas: BufLike;
        to: BufLike;
        value: BufLike;
        input: BufLike;
      };
    };
    receipt: {
      logs: Array<{
        address: BufLike;
        data: { topics: BufLike[]; data: BufLike };
      }>;
    };
  }>;
}

// ============ Pure Helpers ============

/** S3 key for a block number. Folder N has blocks N+1 to N+1000 */
const blockToS3Key = (blockNum: number): string => {
  const million = Math.floor((blockNum - 1) / 1_000_000) * 1_000_000;
  const thousand = Math.floor((blockNum - 1) / 1_000) * 1_000;
  return `${million}/${thousand}/${blockNum}.rmp.lz4`;
};

/**
 * Extract "from" address from ERC20 Transfer event log.
 * Transfer(indexed from, indexed to, value) -> from is in topics[1]
 */
const extractFromAddressFromLogs = (
  logs: S3BlockData["system_txs"][0]["receipt"]["logs"],
  contractAddress: string
): string | null => {
  const target = contractAddress.toLowerCase();
  for (const log of logs) {
    if (toHex(log.address).toLowerCase() !== target) continue;
    const topics = log.data.topics;
    if (!topics || topics.length < 3) continue;
    if (toHex(topics[0]!).toLowerCase() !== TRANSFER_EVENT_TOPIC) continue;
    return ("0x" + toHex(topics[1]!).slice(-40)).toLowerCase();
  }
  return null;
};

/** Parse raw S3 block data into our BlockData format */
const parseS3Block = (blockNum: number, raw: S3BlockData): BlockData => ({
  number: blockNum,
  hash: toHex(raw.block.Reth115.header.hash),
  timestamp: Number(toBigInt(raw.block.Reth115.header.header.timestamp)) * 1000,
  systemTxs: parseSystemTxs(raw.system_txs),
});

/** Parse system transactions from S3 format to our normalized SystemTx format */
const parseSystemTxs = (sysTxs: S3BlockData["system_txs"]): SystemTx[] => {
  const results: SystemTx[] = [];

  for (const sysTx of sysTxs) {
    const txData = sysTx.tx.Legacy;
    if (!txData) continue;

    const txTo = toHex(txData.to).toLowerCase();
    const txValue = toBigInt(txData.value);
    const input = toHex(txData.input);

    const txFields = {
      chainId: toBigInt(txData.chainId),
      nonce: toBigInt(txData.nonce),
      gasPrice: toBigInt(txData.gasPrice),
      gas: toBigInt(txData.gas),
      to: txTo,
      value: txValue,
      input,
    };

    // HYPE (native): empty input, value > 0
    if (input === "0x" && txValue > 0n) {
      const { hash, explorerHash } = computeTxHashes(txFields, HYPE_SYSTEM_ADDRESS);
      results.push({
        hash,
        explorerHash,
        from: HYPE_SYSTEM_ADDRESS,
        assetRecipient: txTo,
        amountWei: txValue.toString(),
        contractAddress: null,
      });
      continue;
    }

    // ERC20: decode transfer(to, amount) from calldata
    const decoded = decodeTransferInput(input);
    if (decoded) {
      const fromAddress = extractFromAddressFromLogs(sysTx.receipt.logs, txTo);
      if (!fromAddress) continue;

      const { hash, explorerHash } = computeTxHashes(txFields, fromAddress);
      results.push({
        hash,
        explorerHash,
        from: fromAddress,
        assetRecipient: decoded.to,
        amountWei: decoded.amount.toString(),
        contractAddress: txTo,
      });
    }
  }

  return results;
};

// ============ S3 Fetch Effect ============

/** Sign and fetch a single block from S3 */
const fetchBlock = (
  signer: SignatureV4,
  blockNum: number
): Effect.Effect<BlockData, BlockFetchError> =>
  Effect.gen(function* () {
    const path = "/" + blockToS3Key(blockNum);
    const url = `https://${S3_HOSTNAME}${path}`;

    // Sign the request
    const signed = yield* Effect.tryPromise({
      try: () =>
        signer.sign({
          method: "GET",
          protocol: "https:",
          hostname: S3_HOSTNAME,
          path,
          headers: {
            host: S3_HOSTNAME,
            "x-amz-request-payer": "requester",
            "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
          },
        }),
      catch: (e) => new BlockFetchError({ message: `Sign failed: ${errorMessage(e)}`, strategy: "s3", cause: e }),
    });

    // Fetch with interruption support
    const resp = yield* Effect.async<Response, BlockFetchError>((resume, signal) => {
      fetch(url, {
        method: "GET",
        headers: signed.headers as Record<string, string>,
        signal,
      })
        .then((r) => resume(Effect.succeed(r)))
        .catch((e) => resume(Effect.fail(new BlockFetchError({ message: errorMessage(e), strategy: "s3", cause: e }))));
    }).pipe(
      Effect.timeoutFail({
        duration: Duration.millis(REQUEST_TIMEOUT_MS),
        onTimeout: () => new BlockFetchError({ message: `Timeout after ${REQUEST_TIMEOUT_MS}ms`, strategy: "s3" }),
      })
    );

    if (!resp.ok) {
      return yield* Effect.fail(
        new BlockFetchError({ message: `HTTP ${resp.status}: ${resp.statusText}`, strategy: "s3" })
      );
    }

    // Decompress and parse
    const compressed = Buffer.from(
      yield* Effect.tryPromise({
        try: () => resp.arrayBuffer(),
        catch: (e) => new BlockFetchError({ message: `Read failed: ${errorMessage(e)}`, strategy: "s3", cause: e }),
      })
    );

    const data = unpack(decompressFrameSync(compressed)) as [S3BlockData];
    if (!data[0]) {
      return yield* Effect.fail(new BlockFetchError({ message: `Invalid data for block ${blockNum}`, strategy: "s3" }));
    }

    return parseS3Block(blockNum, data[0]);
  });

// ============ S3 Fetcher Layer ============

/** Retry policy: exponential backoff with jitter, only for transient errors */
const retryPolicy = Schedule.exponential(Duration.millis(200), 2).pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(3)),
  Schedule.whileInput((e: BlockFetchError) =>
    e.message.includes("Timeout") ||
    e.message.includes("HTTP 503") ||
    e.message.includes("HTTP 500") ||
    e.message.includes("HTTP 429")
  )
);

export const S3FetcherLive = Layer.effect(
  S3Fetcher,
  Effect.gen(function* () {
    const config = yield* S3Config;

    const signer = new SignatureV4({
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      region: S3_REGION,
      service: "s3",
      sha256: Sha256,
    });

    return {
      name: "s3" as const,

      fetchBlocks: (blockNumbers: number[]) =>
        Effect.gen(function* () {
          if (blockNumbers.length === 0) return [];

          const results = yield* Effect.forEach(
            blockNumbers,
            (n) => fetchBlock(signer, n).pipe(Effect.retry(retryPolicy)),
            { concurrency: "unbounded" }
          );

          return results.sort((a, b) => a.number - b.number);
        }),
    };
  })
);
