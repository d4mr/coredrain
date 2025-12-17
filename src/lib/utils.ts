/**
 * Shared utility functions for address formatting and hex conversion.
 */

import {
  toHex as viemToHex,
  fromHex as viemFromHex,
  parseUnits,
  type Hex,
} from "viem";
import { HYPE_SYSTEM_ADDRESS, SPOT_SYSTEM_PREFIX } from "../config";

/** Convert a number to hex string with 0x prefix */
export const toHex = (n: number): Hex => viemToHex(n);

/** Convert a hex string to number */
export const fromHex = (hex: Hex): number => viemFromHex(hex, "number");

/** Normalize address to lowercase */
export const normalizeAddress = (addr: string): string => addr.toLowerCase();

/**
 * Compute the system address for a spot token index.
 * HYPE uses 0x2222...2222, spot tokens use 0x2000...{index as 3-char hex}
 */
export const computeSystemAddress = (index: number): string => {
  // System address format: 0x2 + 36 zeros + {index as 3-char hex} = 42 chars total
  const hexIndex = index.toString(16).padStart(3, "0");
  return `${SPOT_SYSTEM_PREFIX}${hexIndex}`;
};

/**
 * Check if an address is a system address (HYPE or spot token).
 * System addresses start with 0x2000... or are the HYPE address 0x2222...
 */
export const isSystemAddress = (addr: string): boolean => {
  const normalized = normalizeAddress(addr);
  return (
    normalized === HYPE_SYSTEM_ADDRESS ||
    normalized.startsWith(SPOT_SYSTEM_PREFIX.slice(0, 10)) // "0x20000000"
  );
};

/**
 * Check if an address is the HYPE native token system address.
 */
export const isHypeAddress = (addr: string): boolean => {
  return normalizeAddress(addr) === HYPE_SYSTEM_ADDRESS;
};

/**
 * Parse a human-readable amount string to bigint in smallest units.
 * e.g., "10827.401816" with decimals=6 → 10827401816n
 */
export const parseAmount = (amount: string, decimals: number): bigint => {
  return parseUnits(amount, decimals);
};

/**
 * Extract token index from a system address.
 * Returns null for HYPE or invalid addresses.
 */
export const extractIndexFromSystemAddress = (addr: string): number | null => {
  const normalized = normalizeAddress(addr);
  if (normalized === HYPE_SYSTEM_ADDRESS) return null;
  if (!normalized.startsWith(SPOT_SYSTEM_PREFIX.slice(0, 10))) return null; // "0x20000000"
  
  // Last 3 chars are the hex index
  const hexIndex = normalized.slice(-3);
  return viemFromHex(`0x${hexIndex}`, "number");
};
