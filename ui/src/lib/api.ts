/**
 * API client for Coredrain backend
 */

import type {
  Transfer,
  TransfersResponse,
  AddressesResponse,
  StatsResponse,
  TransferStatus,
} from "@/types";

// API URL - can be configured via VITE_API_URL environment variable
// Defaults to localhost:9465 for local development
const API_BASE = import.meta.env.VITE_API_URL as string;

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch transfers with optional filters
 */
export interface TransferFilters {
  status?: TransferStatus;
  watchedAddress?: string;
  user?: string;
  token?: string;
  limit?: number;
  offset?: number;
}

export async function fetchTransfers(
  filters: TransferFilters = {}
): Promise<TransfersResponse> {
  const params = new URLSearchParams();

  if (filters.status) params.set("status", filters.status);
  if (filters.watchedAddress) params.set("watchedAddress", filters.watchedAddress);
  if (filters.user) params.set("user", filters.user);
  if (filters.token) params.set("token", filters.token);
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.offset) params.set("offset", String(filters.offset));

  const query = params.toString();
  return fetchApi<TransfersResponse>(`/transfers${query ? `?${query}` : ""}`);
}

/**
 * Fetch a single transfer by any hash
 */
export async function fetchTransferByHash(hash: string): Promise<Transfer> {
  const response = await fetchApi<{ data: Transfer }>(`/transfers/${hash}`);
  return response.data;
}

/**
 * Fetch all watched addresses
 */
export async function fetchAddresses(): Promise<AddressesResponse> {
  return fetchApi<AddressesResponse>("/addresses");
}

/**
 * Fetch system stats
 */
export async function fetchStats(): Promise<StatsResponse> {
  return fetchApi<StatsResponse>("/stats");
}

/**
 * Health check
 */
export async function fetchHealth(): Promise<{ status: string }> {
  return fetchApi<{ status: string }>("/health");
}

// ============================================================================
// Hyperliquid API
// ============================================================================

const HYPERLIQUID_API = "https://api.hyperliquid.xyz/info";

/**
 * Fetch spot token metadata from Hyperliquid
 */
export async function fetchSpotMeta(): Promise<{ tokens: import("@/types").SpotToken[] }> {
  const response = await fetch(HYPERLIQUID_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "spotMeta" }),
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get token image URL
 */
export function getTokenImageUrl(tokenName: string): string {
  return `https://app.hyperliquid.xyz/coins/${tokenName}.svg`;
}
