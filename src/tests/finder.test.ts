/**
 * Snapshot tests for the EVM transaction finder.
 *
 * Uses real matched transfer data from MongoDB to verify:
 * 1. Block estimation finds the correct region
 * 2. Transaction matching logic works for different token types
 * 3. The finder produces correct results for known good transfers
 *
 * Tests both S3 and RPC strategies to ensure parity.
 *
 * These tests require S3 access to fetch real block data.
 * Run with: S3_ACCESS_KEY_ID=xxx S3_SECRET_ACCESS_KEY=xxx bun test src/tests/finder.test.ts
 */

import { test, expect, describe, beforeAll, mock } from "bun:test";
import { Effect, Layer } from "effect";
import { findEvmHash } from "../services/finder";
import {
  S3Fetcher,
  RpcFetcher,
  type BlockFetcherService,
} from "../strategies/types";
import { S3FetcherLive } from "../strategies/s3";
import { RpcFetcherLive } from "../strategies/rpc";
import { S3ConfigLive } from "../config";
import { initializeAssetCache } from "../cache/assets";
import type { Transfer } from "../models/transfer";
import type { SystemTransaction } from "../models/system-tx";
import fixtureData from "./fixtures/transfers.json";

// Cast fixture data to Transfer type (they have all required fields)
const fixtures = fixtureData as unknown as (Transfer & {
  hyperevmExplorerHash: string;
})[];

// Type definitions for mock return values
type BracketingAnchors = {
  before: { blockNumber: number; blockTimestamp: number } | null;
  after: { blockNumber: number; blockTimestamp: number } | null;
};

// Mock state, we use functions that read from these
let mockBracketingAnchorsResult: BracketingAnchors = {
  before: null,
  after: null,
};
let mockFindMatchingTxResult: SystemTransaction | null = null;

// Mock the system-tx module for anchor queries
// WHY Effect.succeed? The model functions now return Effects, not Promises.
mock.module("../models/system-tx", () => ({
  findBracketingAnchors: () => Effect.succeed(mockBracketingAnchorsResult),
  storeBlocksSystemTxs: () => Effect.void,
  findMatchingTx: () => Effect.succeed(mockFindMatchingTxResult),
}));

// Helper to set up anchor mocks for a specific transfer
const setupAnchorsForTransfer = (
  transfer: Transfer & { hyperevmExplorerHash: string }
) => {
  const targetBlock = transfer.hyperevmBlock!;
  const targetTime = transfer.hypercoreTime;

  // Create bracketing anchors around the target
  mockBracketingAnchorsResult = {
    before: {
      blockNumber: Math.max(1, targetBlock - 500),
      blockTimestamp: targetTime - 500,
    },
    after: {
      blockNumber: targetBlock + 500,
      blockTimestamp: targetTime + 500,
    },
  };
};

// Initialize asset cache before tests
beforeAll(async () => {
  await Effect.runPromise(initializeAssetCache);
});

// Check if AWS credentials are available for S3 tests
const hasAwsCredentials = !!(
  process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
);

// Create the S3 fetcher layer for tests
const S3TestLayer = S3FetcherLive.pipe(Layer.provide(S3ConfigLive));

// Create the RPC fetcher layer for tests
const RpcTestLayer = RpcFetcherLive;

describe("finder snapshot tests", () => {
  describe.skipIf(!hasAwsCredentials)("with S3 strategy", () => {
    // Test HYPE transfers (early and late blocks)
    const hypeFixtures = fixtures.filter((f) => f.token === "HYPE").slice(0, 3);

    for (const transfer of hypeFixtures) {
      test(`finds HYPE transfer block ${transfer.hyperevmBlock}`, async () => {
        setupAnchorsForTransfer(transfer);
        mockFindMatchingTxResult = null;

        const program = Effect.gen(function* () {
          const fetcher = yield* S3Fetcher;
          return yield* findEvmHash(transfer, fetcher);
        });

        const result = await Effect.runPromise(
          program.pipe(Effect.provide(S3TestLayer))
        );

        // Verify both hashes
        expect(result.hash).toBe(transfer.hyperevmHash!);
        expect(result.explorerHash).toBe(transfer.hyperevmExplorerHash);
        expect(result.block).toBe(transfer.hyperevmBlock!);
        expect(result.blockHash).toBe(transfer.hyperevmBlockHash!);

        expect(result.rounds).toBeLessThanOrEqual(15);
        expect(result.blocksSearched).toBeGreaterThan(0);
      }, 60000);
    }

    // Test ERC20 transfers (PURR, UBTC, etc.)
    const erc20Fixtures = fixtures
      .filter((f) => f.token !== "HYPE")
      .slice(0, 3);

    for (const transfer of erc20Fixtures) {
      test(`finds ${transfer.token} transfer block ${transfer.hyperevmBlock}`, async () => {
        setupAnchorsForTransfer(transfer);
        mockFindMatchingTxResult = null;

        const program = Effect.gen(function* () {
          const fetcher = yield* S3Fetcher;
          return yield* findEvmHash(transfer, fetcher);
        });

        const result = await Effect.runPromise(
          program.pipe(Effect.provide(S3TestLayer))
        );

        // Verify both hashes, especially important for ERC20
        // because explorer hash uses the system address from logs
        expect(result.hash).toBe(transfer.hyperevmHash!);
        expect(result.explorerHash).toBe(transfer.hyperevmExplorerHash);
        expect(result.block).toBe(transfer.hyperevmBlock!);

        // ERC20 should have contract address set
        expect(result.contractAddress).toBe(transfer.contractAddress);

        expect(result.rounds).toBeLessThanOrEqual(15);
      }, 60000);
    }
  });

  describe("with RPC strategy", () => {
    // Test HYPE transfers with RPC
    const hypeFixtures = fixtures.filter((f) => f.token === "HYPE").slice(0, 2);

    for (const transfer of hypeFixtures) {
      test(`finds HYPE transfer block ${transfer.hyperevmBlock}`, async () => {
        setupAnchorsForTransfer(transfer);
        mockFindMatchingTxResult = null;

        const program = Effect.gen(function* () {
          const fetcher = yield* RpcFetcher;
          return yield* findEvmHash(transfer, fetcher);
        });

        const result = await Effect.runPromise(
          program.pipe(Effect.provide(RpcTestLayer))
        );

        // Verify both hashes
        expect(result.hash).toBe(transfer.hyperevmHash!);
        expect(result.explorerHash).toBe(transfer.hyperevmExplorerHash);
        expect(result.block).toBe(transfer.hyperevmBlock!);
        expect(result.blockHash).toBe(transfer.hyperevmBlockHash!);

        expect(result.rounds).toBeLessThanOrEqual(15);
        expect(result.blocksSearched).toBeGreaterThan(0);
      }, 60000);
    }

    // Test ERC20 transfers with RPC
    const erc20Fixtures = fixtures
      .filter((f) => f.token !== "HYPE")
      .slice(0, 2);

    for (const transfer of erc20Fixtures) {
      test(`finds ${transfer.token} transfer block ${transfer.hyperevmBlock}`, async () => {
        setupAnchorsForTransfer(transfer);
        mockFindMatchingTxResult = null;

        const program = Effect.gen(function* () {
          const fetcher = yield* RpcFetcher;
          return yield* findEvmHash(transfer, fetcher);
        });

        const result = await Effect.runPromise(
          program.pipe(Effect.provide(RpcTestLayer))
        );

        // Verify both hashes
        expect(result.hash).toBe(transfer.hyperevmHash!);
        expect(result.explorerHash).toBe(transfer.hyperevmExplorerHash);
        expect(result.block).toBe(transfer.hyperevmBlock!);

        // ERC20 should have contract address set
        expect(result.contractAddress).toBe(transfer.contractAddress);

        expect(result.rounds).toBeLessThanOrEqual(15);
      }, 60000);
    }
  });

  describe("S3 and RPC parity", () => {
    // Pick one transfer to test both strategies produce identical results
    const testTransfer = fixtures.find((f) => f.token === "HYPE")!;

    test.skipIf(!hasAwsCredentials)(
      "S3 and RPC produce identical hashes",
      async () => {
        setupAnchorsForTransfer(testTransfer);
        mockFindMatchingTxResult = null;

        // Run with S3
        const s3Program = Effect.gen(function* () {
          const fetcher = yield* S3Fetcher;
          return yield* findEvmHash(testTransfer, fetcher);
        });
        const s3Result = await Effect.runPromise(
          s3Program.pipe(Effect.provide(S3TestLayer))
        );

        // Run with RPC
        const rpcProgram = Effect.gen(function* () {
          const fetcher = yield* RpcFetcher;
          return yield* findEvmHash(testTransfer, fetcher);
        });
        const rpcResult = await Effect.runPromise(
          rpcProgram.pipe(Effect.provide(RpcTestLayer))
        );

        // Both should produce identical results
        expect(s3Result.hash).toBe(rpcResult.hash);
        expect(s3Result.explorerHash).toBe(rpcResult.explorerHash);
        expect(s3Result.block).toBe(rpcResult.block);
        expect(s3Result.blockHash).toBe(rpcResult.blockHash);
        expect(s3Result.blockTime).toBe(rpcResult.blockTime);
      },
      120000
    );
  });

  describe("DB cache hit", () => {
    test("returns immediately when tx found in DB", async () => {
      const transfer = fixtures[0]!;

      // Mock a DB cache hit with both hashes
      mockFindMatchingTxResult = {
        hash: transfer.hyperevmHash!,
        explorerHash: transfer.hyperevmExplorerHash,
        blockNumber: transfer.hyperevmBlock!,
        blockHash: transfer.hyperevmBlockHash!,
        blockTimestamp: transfer.hyperevmTime!,
        from: transfer.systemAddress,
        assetRecipient: transfer.user,
        amountWei: transfer.amount,
        contractAddress: transfer.contractAddress,
      } as SystemTransaction;

      // Create a mock fetcher (won't be used due to cache hit)
      const mockFetcher: BlockFetcherService = {
        name: "mock",
        fetchBlocks: () => Effect.succeed([]),
      };

      const result = await Effect.runPromise(
        findEvmHash(transfer, mockFetcher)
      );

      // Should return from DB cache
      expect(result.hash).toBe(transfer.hyperevmHash!);
      expect(result.blocksSearched).toBe(0);
      expect(result.rounds).toBe(0);
    });
  });
});

describe("token type coverage", () => {
  test("fixtures include HYPE (native) transfers", () => {
    const hypeTransfers = fixtures.filter((f) => f.token === "HYPE");
    expect(hypeTransfers.length).toBeGreaterThan(0);

    // HYPE uses the special system address and no contract
    for (const t of hypeTransfers) {
      expect(t.systemAddress).toBe(
        "0x2222222222222222222222222222222222222222"
      );
      expect(t.contractAddress).toBeNull();
    }
  });

  test("fixtures include ERC20 transfers", () => {
    const erc20Transfers = fixtures.filter((f) => f.token !== "HYPE");
    expect(erc20Transfers.length).toBeGreaterThan(0);

    // ERC20s use 0x2000... addresses and have contract addresses
    for (const t of erc20Transfers) {
      expect(t.systemAddress.startsWith("0x2000")).toBe(true);
      expect(t.contractAddress).toBeTruthy();
    }
  });

  test("fixtures include variety of ERC20 tokens", () => {
    const tokens = new Set(fixtures.map((f) => f.token));
    // Should have at least HYPE + some ERC20s
    expect(tokens.size).toBeGreaterThanOrEqual(4);
    expect(tokens.has("HYPE")).toBe(true);
  });

  test("fixtures cover different block ranges", () => {
    const blocks = fixtures.map((f) => f.hyperevmBlock!);
    const minBlock = Math.min(...blocks);
    const maxBlock = Math.max(...blocks);

    // Should span a significant range (early blocks to recent)
    expect(minBlock).toBeLessThan(1000000);
    expect(maxBlock).toBeGreaterThan(10000000);
  });
});

describe("fixture data integrity", () => {
  test("all fixtures have required fields", () => {
    for (const transfer of fixtures) {
      expect(transfer.hypercoreHash).toMatch(/^0x[a-f0-9]{64}$/i);
      expect(transfer.hypercoreTime).toBeGreaterThan(0);
      expect(transfer.token).toBeTruthy();
      expect(transfer.amount).toBeTruthy();
      expect(transfer.user).toMatch(/^0x[a-f0-9]{40}$/i);
      expect(transfer.systemAddress).toMatch(/^0x[a-f0-9]{40}$/i);
      expect(transfer.watchedAddress).toMatch(/^0x[a-f0-9]{40}$/i);
      expect(transfer.hyperevmHash).toMatch(/^0x[a-f0-9]{64}$/i);
      expect(transfer.hyperevmExplorerHash).toMatch(/^0x[a-f0-9]{64}$/i);
      expect(transfer.hyperevmBlock).toBeGreaterThan(0);
      expect(transfer.hyperevmBlockHash).toMatch(/^0x[a-f0-9]{64}$/i);
      expect(transfer.hyperevmTime).toBeGreaterThan(0);
      expect(transfer.status).toBe("matched");
    }
  });

  test("hypercore time is close to hyperevm time", () => {
    for (const transfer of fixtures) {
      const diffMs = Math.abs(transfer.hyperevmTime! - transfer.hypercoreTime);
      // Should be within 5 seconds
      expect(diffMs).toBeLessThan(5000);
    }
  });

  test("ERC20 transfers have contract addresses", () => {
    const erc20Transfers = fixtures.filter((f) => f.token !== "HYPE");
    for (const transfer of erc20Transfers) {
      expect(transfer.contractAddress).toMatch(/^0x[a-f0-9]{40}$/i);
    }
  });

  test("HYPE transfers have null contract addresses", () => {
    const hypeTransfers = fixtures.filter((f) => f.token === "HYPE");
    for (const transfer of hypeTransfers) {
      expect(transfer.contractAddress).toBeNull();
    }
  });
});
