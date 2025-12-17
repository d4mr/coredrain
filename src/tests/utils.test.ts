/**
 * Tests for utility functions.
 */

import { describe, test, expect } from "bun:test";
import {
  toHex,
  fromHex,
  normalizeAddress,
  computeSystemAddress,
  isSystemAddress,
  isHypeAddress,
  parseAmount,
  extractIndexFromSystemAddress,
} from "../lib/utils";
import { HYPE_SYSTEM_ADDRESS } from "../config";

describe("toHex", () => {
  test("converts numbers to hex", () => {
    expect(toHex(0)).toBe("0x0");
    expect(toHex(255)).toBe("0xff");
    expect(toHex(2825475)).toBe("0x2b1d03");
  });
});

describe("fromHex", () => {
  test("converts hex to numbers", () => {
    expect(fromHex("0x0")).toBe(0);
    expect(fromHex("0xff")).toBe(255);
    expect(fromHex("0x2b1d03")).toBe(2825475);
  });
});

describe("normalizeAddress", () => {
  test("lowercases addresses", () => {
    expect(normalizeAddress("0xABC")).toBe("0xabc");
    expect(normalizeAddress("0x2222222222222222222222222222222222222222")).toBe(
      "0x2222222222222222222222222222222222222222"
    );
  });
});

describe("computeSystemAddress", () => {
  test("computes correct system address for index 0", () => {
    expect(computeSystemAddress(0)).toBe(
      "0x2000000000000000000000000000000000000000"
    );
  });

  test("computes correct system address for index 222 (BUDDY)", () => {
    expect(computeSystemAddress(222)).toBe(
      "0x20000000000000000000000000000000000000de"
    );
  });

  test("computes correct system address for index 5 (JEFF)", () => {
    expect(computeSystemAddress(5)).toBe(
      "0x2000000000000000000000000000000000000005"
    );
  });

  test("computes correct system address for index 268 (USDT0)", () => {
    expect(computeSystemAddress(268)).toBe(
      "0x200000000000000000000000000000000000010c"
    );
  });
});

describe("isSystemAddress", () => {
  test("recognizes HYPE system address", () => {
    expect(isSystemAddress(HYPE_SYSTEM_ADDRESS)).toBe(true);
  });

  test("recognizes spot token system addresses", () => {
    expect(isSystemAddress("0x20000000000000000000000000000000000000de")).toBe(
      true
    );
    expect(isSystemAddress("0x2000000000000000000000000000000000000000")).toBe(
      true
    );
    expect(isSystemAddress("0x200000000000000000000000000000000000010c")).toBe(
      true
    ); // USDT0
  });

  test("rejects non-system addresses", () => {
    expect(isSystemAddress("0x1234567890123456789012345678901234567890")).toBe(
      false
    );
  });
});

describe("isHypeAddress", () => {
  test("recognizes HYPE address", () => {
    expect(isHypeAddress(HYPE_SYSTEM_ADDRESS)).toBe(true);
    expect(isHypeAddress("0x2222222222222222222222222222222222222222")).toBe(
      true
    );
  });

  test("rejects non-HYPE addresses", () => {
    expect(isHypeAddress("0x20000000000000000000000000000000000000de")).toBe(
      false
    );
  });
});

describe("parseAmount", () => {
  test("parses whole numbers", () => {
    expect(parseAmount("100", 18)).toBe(100000000000000000000n);
    expect(parseAmount("100", 6)).toBe(100000000n);
  });

  test("parses decimals", () => {
    expect(parseAmount("10.5", 18)).toBe(10500000000000000000n);
    expect(parseAmount("10.5", 6)).toBe(10500000n);
  });

  test("handles BUDDY example (8-2=6 decimals)", () => {
    // BUDDY: weiDecimals=8, evm_extra_wei_decimals=-2, so evmDecimals=6
    expect(parseAmount("10827.401816", 6)).toBe(10827401816n);
  });

  test("handles HYPE (18 decimals)", () => {
    expect(parseAmount("4.54962092", 18)).toBe(4549620920000000000n);
  });

  test("rounds excess decimals", () => {
    // viem's parseUnits rounds instead of truncating
    expect(parseAmount("1.123456789", 6)).toBe(1123457n);
    expect(parseAmount("1.123456111", 6)).toBe(1123456n);
  });

  test("pads missing decimals", () => {
    expect(parseAmount("1.1", 6)).toBe(1100000n);
  });
});

describe("extractIndexFromSystemAddress", () => {
  test("extracts index from spot token address", () => {
    expect(
      extractIndexFromSystemAddress("0x20000000000000000000000000000000000000de")
    ).toBe(222);
    expect(
      extractIndexFromSystemAddress("0x2000000000000000000000000000000000000005")
    ).toBe(5);
    expect(
      extractIndexFromSystemAddress("0x2000000000000000000000000000000000000000")
    ).toBe(0);
    expect(
      extractIndexFromSystemAddress("0x200000000000000000000000000000000000010c")
    ).toBe(268); // USDT0
  });

  test("returns null for HYPE address", () => {
    expect(extractIndexFromSystemAddress(HYPE_SYSTEM_ADDRESS)).toBe(null);
  });

  test("returns null for invalid addresses", () => {
    expect(
      extractIndexFromSystemAddress("0x1234567890123456789012345678901234567890")
    ).toBe(null);
  });
});
