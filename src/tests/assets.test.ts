/**
 * Tests for asset cache functionality.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { Effect } from "effect";
import {
  initializeAssetCache,
  getAssetBySystemAddress,
  getAssetByName,
  getEvmDecimals,
  isInitialized,
} from "../cache/assets";
import { HYPE_SYSTEM_ADDRESS } from "../config";

// Initialize cache before tests
beforeAll(async () => {
  await Effect.runPromise(initializeAssetCache);
});

describe("asset cache", () => {
  test("initializes successfully", () => {
    expect(isInitialized()).toBe(true);
  });

  test("has HYPE asset", () => {
    const hype = getAssetByName("HYPE");
    expect(hype).toBeDefined();
    expect(hype!.name).toBe("HYPE");
    expect(hype!.evmDecimals).toBe(18);
    expect(hype!.systemAddress).toBe(HYPE_SYSTEM_ADDRESS);
  });

  test("can look up by system address", () => {
    const hype = getAssetBySystemAddress(HYPE_SYSTEM_ADDRESS);
    expect(hype).toBeDefined();
    expect(hype!.name).toBe("HYPE");
  });

  test("returns correct EVM decimals for known tokens", () => {
    // USDC: weiDecimals=8, evm_extra=-2 → evmDecimals=6
    const usdc = getAssetByName("USDC");
    expect(usdc).toBeDefined();
    expect(usdc!.evmDecimals).toBe(6);
  });

  test("getEvmDecimals returns fallback for unknown address", () => {
    const decimals = getEvmDecimals("0x1234567890123456789012345678901234567890");
    expect(decimals).toBe(18); // default fallback
  });
});

describe("asset decimal calculations", () => {
  test("BUDDY has correct decimals (8 + (-2) = 6)", () => {
    const buddy = getAssetByName("BUDDY");
    if (buddy) {
      expect(buddy.weiDecimals).toBe(8);
      expect(buddy.evmExtraWeiDecimals).toBe(-2);
      expect(buddy.evmDecimals).toBe(6);
    }
  });

  test("PURR has correct decimals (5 + 13 = 18)", () => {
    const purr = getAssetByName("PURR");
    if (purr) {
      expect(purr.weiDecimals).toBe(5);
      expect(purr.evmExtraWeiDecimals).toBe(13);
      expect(purr.evmDecimals).toBe(18);
    }
  });
});
