/**
 * In-memory cache for spot asset metadata.
 * 
 * Loaded from HyperCore spotMeta API on startup, refreshed on-demand
 * when encountering unknown assets. Provides fast lookups for:
 * - Token decimals (EVM-side)
 * - System addresses
 * - Token contracts
 * 
 * Usage:
 *   yield* initializeAssetCache
 *   const asset = getAssetBySystemAddress("0x2000...de")
 *   const decimals = asset?.evmDecimals ?? 18
 * 
 * Idiomatic effect usage would have been to make this a service, but its easier to use it this way.
 */

import { Effect, Schedule, Duration } from "effect";
import { HYPE_SYSTEM_ADDRESS } from "../config";
import { computeSystemAddress, normalizeAddress } from "../lib/utils";

/** Spot asset metadata */
export interface SpotAsset {
  name: string;
  index: number;
  weiDecimals: number;
  evmExtraWeiDecimals: number;
  evmDecimals: number; // computed: weiDecimals + evmExtraWeiDecimals
  systemAddress: string; // computed: 0x2000...{index} or 0x2222... for HYPE
  evmContract: string | null;
}

/** Raw token from spotMeta API */
interface SpotMetaToken {
  name: string;
  index: number;
  weiDecimals: number;
  evmContract: {
    address: string;
    evm_extra_wei_decimals: number;
  } | null;
}

/** Raw response from spotMeta API */
interface SpotMetaResponse {
  tokens: SpotMetaToken[];
  universe: unknown[];
}

// In-memory caches
let byIndex = new Map<number, SpotAsset>();
let bySystemAddress = new Map<string, SpotAsset>();
let byName = new Map<string, SpotAsset>();
let initialized = false;

/** HYPE special asset, native token with fixed properties */
const HYPE_ASSET: SpotAsset = {
  name: "HYPE",
  index: -1, // special marker
  weiDecimals: 18,
  evmExtraWeiDecimals: 0,
  evmDecimals: 18,
  systemAddress: HYPE_SYSTEM_ADDRESS,
  evmContract: null,
};

/** Retry schedule for API calls: 3 retries with exponential backoff */
const retrySchedule = Schedule.exponential(Duration.seconds(1), 2).pipe(
  Schedule.intersect(Schedule.recurs(3))
);

/**
 * Fetch spot metadata from HyperCore API.
 */
const fetchSpotMeta = Effect.tryPromise({
  try: async (): Promise<SpotMetaResponse> => {
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMeta" }),
    });
    if (!response.ok) {
      throw new Error(`spotMeta API error: ${response.status}`);
    }
    return response.json() as Promise<SpotMetaResponse>;
  },
  catch: (error) => new Error(`Failed to fetch spotMeta: ${error}`),
}).pipe(Effect.retry(retrySchedule));

/**
 * Parse a raw token into a SpotAsset.
 */
const parseToken = (token: SpotMetaToken): SpotAsset => {
  const evmExtraWeiDecimals = token.evmContract?.evm_extra_wei_decimals ?? 0;
  const evmDecimals = token.weiDecimals + evmExtraWeiDecimals;
  const systemAddress = computeSystemAddress(token.index);

  return {
    name: token.name,
    index: token.index,
    weiDecimals: token.weiDecimals,
    evmExtraWeiDecimals,
    evmDecimals,
    systemAddress,
    evmContract: token.evmContract?.address ?? null,
  };
};

/**
 * Populate caches from API response.
 */
const populateCaches = (response: SpotMetaResponse): void => {
  // Clear existing
  byIndex.clear();
  bySystemAddress.clear();
  byName.clear();

  // Add all tokens from API first
  for (const token of response.tokens) {
    const asset = parseToken(token);
    byIndex.set(asset.index, asset);
    bySystemAddress.set(normalizeAddress(asset.systemAddress), asset);
    byName.set(asset.name, asset);
  }

  // Override HYPE with correct native token properties
  // HYPE in the API has weiDecimals=8 but as native token it uses 18 decimals
  byName.set("HYPE", HYPE_ASSET);
  bySystemAddress.set(HYPE_SYSTEM_ADDRESS, HYPE_ASSET);

  initialized = true;
};

/**
 * Initialize the asset cache from the HyperCore API.
 * Must be called before using other cache functions.
 */
export const initializeAssetCache = Effect.gen(function* () {
  yield* Effect.logInfo("Loading spot asset metadata...");
  const response = yield* fetchSpotMeta;
  populateCaches(response);
  yield* Effect.logInfo(`Loaded ${byIndex.size} spot assets`);
});

/**
 * Refresh the asset cache from the API.
 * Call this when encountering an unknown asset.
 */
export const refreshAssetCache = Effect.gen(function* () {
  yield* Effect.logDebug("Refreshing spot asset cache...");
  const response = yield* fetchSpotMeta;
  populateCaches(response);
  yield* Effect.logDebug(`Refreshed: ${byIndex.size} spot assets`);
});

/**
 * Get asset by system address.
 * Returns HYPE_ASSET for 0x2222..., spot assets for 0x2000...
 */
export const getAssetBySystemAddress = (
  systemAddress: string
): SpotAsset | undefined => {
  return bySystemAddress.get(normalizeAddress(systemAddress));
};

/**
 * Get asset by token name.
 */
export const getAssetByName = (name: string): SpotAsset | undefined => {
  return byName.get(name);
};

/**
 * Get asset by token index.
 */
export const getAssetByIndex = (index: number): SpotAsset | undefined => {
  return byIndex.get(index);
};

/**
 * Check if cache is initialized.
 */
export const isInitialized = (): boolean => initialized;

/**
 * Get all cached assets (for debugging).
 */
export const getAllAssets = (): SpotAsset[] => Array.from(byIndex.values());

/**
 * Get EVM decimals for a system address, with fallback.
 * If asset not found, returns 18 as default.
 */
export const getEvmDecimals = (systemAddress: string): number => {
  const asset = getAssetBySystemAddress(systemAddress);
  return asset?.evmDecimals ?? 18;
};

/**
 * Clear cache (for testing).
 */
export const clearAssetCache = (): void => {
  byIndex.clear();
  bySystemAddress.clear();
  byName.clear();
  initialized = false;
};
