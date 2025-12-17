/**
 * HyperCore API types and utilities.
 *
 * The actual API fetching is done in core-indexer.ts with reactive 429 backoff.
 * This file just exports the types and helper functions.
 */

/** Raw ledger update from API */
export interface LedgerUpdate {
  time: number;
  hash: string;
  delta: {
    type: string;
    token?: string;
    amount?: string;
    user?: string;
    destination?: string;
    usdcValue?: string;
    fee?: string;
    nativeTokenFee?: string;
    nonce?: number;
    feeToken?: string;
    [key: string]: unknown;
  };
}

/** Spot transfer (filtered from ledger updates) */
export interface SpotTransfer {
  time: number;
  hash: string;
  token: string;
  amount: string;
  user: string;
  destination: string;
  /** USD value at time of transfer */
  usdcValue: string | null;
  /** Fee in token */
  fee: string | null;
  /** Fee in HYPE */
  nativeTokenFee: string | null;
}

/**
 * Extract spot transfers from ledger updates.
 * Only includes transfers where delta.type === "spotTransfer".
 */
export const filterSpotTransfers = (updates: LedgerUpdate[]): SpotTransfer[] =>
  updates
    .filter((u) => u.delta.type === "spotTransfer")
    .map((u) => ({
      time: u.time,
      hash: u.hash,
      token: u.delta.token!,
      amount: u.delta.amount!,
      user: u.delta.user!,
      destination: u.delta.destination!,
      usdcValue: u.delta.usdcValue ?? null,
      fee: u.delta.fee ?? null,
      nativeTokenFee: u.delta.nativeTokenFee ?? null,
    }));
