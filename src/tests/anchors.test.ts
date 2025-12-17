/**
 * Tests for block anchor estimation.
 *
 * Since anchors are now stored in MongoDB, these tests focus on
 * the estimation algorithm using mocked data. The mocked findBracketingAnchors
 * is designed to never fail, so we can use Effect.runPromise directly.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Effect } from "effect";

// Define the anchor type
type Anchor = { blockNumber: number; blockTimestamp: number } | null;
type BracketResult = { before: Anchor; after: Anchor };

// Mock the system-tx module before importing anchors
// The mock returns an Effect that succeeds with the bracketing result
const mockFindBracketingAnchorsImpl = mock<() => BracketResult>(() => ({
  before: null,
  after: null,
}));

mock.module("../models/system-tx", () => ({
  findBracketingAnchors: (_targetTime: number) =>
    Effect.succeed(mockFindBracketingAnchorsImpl()),
  storeBlockSystemTxs: (_block: unknown) => Effect.void,
}));

import { estimateBlock } from "../cache/anchors";

/** Seed anchor values (hardcoded in anchors.ts) */
const SEED_BLOCK = 1;
const SEED_TIME = 1739849780000;
const DEFAULT_MS_PER_BLOCK = 1000;

beforeEach(() => {
  mockFindBracketingAnchorsImpl.mockReset();
  mockFindBracketingAnchorsImpl.mockImplementation(() => ({
    before: null,
    after: null,
  }));
});

/**
 * Helper to run an Effect and get the result as a Promise.
 * Since our mocks never fail, we can use Effect.runPromise directly.
 */
const runEffect = <A>(effect: Effect.Effect<A, unknown, never>): Promise<A> =>
  Effect.runPromise(effect);

describe("estimateBlock", () => {
  test("falls back to seed anchor when DB is empty", async () => {
    // No anchors in DB
    mockFindBracketingAnchorsImpl.mockReturnValue({
      before: null,
      after: null,
    });

    // 100 seconds after seed = ~100 blocks
    const result = await runEffect(estimateBlock(SEED_TIME + 100000));
    expect(result.block).toBe(SEED_BLOCK + 100);
    expect(result.msPerBlock).toBe(DEFAULT_MS_PER_BLOCK);
  });

  test("extrapolates from closest anchor (before)", async () => {
    mockFindBracketingAnchorsImpl.mockReturnValue({
      before: { blockNumber: 1000, blockTimestamp: SEED_TIME + 1000000 },
      after: null,
    });

    // 50 seconds after the anchor
    const result = await runEffect(estimateBlock(SEED_TIME + 1050000));
    expect(result.block).toBe(1050);
    expect(result.msPerBlock).toBe(DEFAULT_MS_PER_BLOCK);
  });

  test("extrapolates from closest anchor (after)", async () => {
    mockFindBracketingAnchorsImpl.mockReturnValue({
      before: null,
      after: { blockNumber: 2000, blockTimestamp: SEED_TIME + 2000000 },
    });

    // 100 seconds before the anchor
    const result = await runEffect(estimateBlock(SEED_TIME + 1900000));
    expect(result.block).toBe(1900);
    expect(result.msPerBlock).toBe(DEFAULT_MS_PER_BLOCK);
  });

  test("interpolates between two anchors", async () => {
    mockFindBracketingAnchorsImpl.mockReturnValue({
      before: { blockNumber: 1000, blockTimestamp: SEED_TIME + 1000000 },
      after: { blockNumber: 2000, blockTimestamp: SEED_TIME + 2000000 },
    });

    // Midpoint between anchors
    const result = await runEffect(estimateBlock(SEED_TIME + 1500000));
    expect(result.block).toBe(1500);
    expect(result.msPerBlock).toBe(1000); // (2000000-1000000)/(2000-1000) = 1000
  });

  test("interpolates with variable block times", async () => {
    // Anchors with 500ms per block (faster than default)
    mockFindBracketingAnchorsImpl.mockReturnValue({
      before: { blockNumber: 1000, blockTimestamp: SEED_TIME + 500000 },
      after: { blockNumber: 2000, blockTimestamp: SEED_TIME + 1000000 },
    });

    // Midpoint
    const result = await runEffect(estimateBlock(SEED_TIME + 750000));
    expect(result.block).toBe(1500);
    expect(result.msPerBlock).toBe(500);
  });

  test("returns positive block numbers for old timestamps", async () => {
    mockFindBracketingAnchorsImpl.mockReturnValue({
      before: null,
      after: null,
    });

    // Very old time (before chain start)
    const result = await runEffect(estimateBlock(0));
    expect(result.block).toBeGreaterThanOrEqual(1);
  });

  test("handles same block for before and after (exact match)", async () => {
    const exactTime = SEED_TIME + 1000000;
    mockFindBracketingAnchorsImpl.mockReturnValue({
      before: { blockNumber: 1000, blockTimestamp: exactTime },
      after: { blockNumber: 1000, blockTimestamp: exactTime },
    });

    // Query for exact anchor time, should extrapolate since before === after
    const result = await runEffect(estimateBlock(exactTime));
    expect(result.block).toBe(1000);
  });
});
