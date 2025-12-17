/**
 * Shared utilities for block fetching strategies.
 *
 * Contains common ERC20 decoding and transaction hash computation logic
 * used by both S3 and RPC fetchers.
 */

import { keccak256, toRlp, toHex as viemToHex } from "viem";

/** ERC20 transfer function selector: transfer(address,uint256) */
export const TRANSFER_SELECTOR = "a9059cbb";
export const TRANSFER_SELECTOR_WITH_PREFIX = "0xa9059cbb";

/** ERC20 Transfer event topic: Transfer(address,address,uint256) */
export const TRANSFER_EVENT_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Decode ERC20 transfer(address,uint256) call data.
 * Returns { to, amount } or null if not a transfer call.
 *
 * Input format: 0x + selector(4 bytes) + to(32 bytes) + amount(32 bytes)
 * Total: 2 + 8 + 64 + 64 = 138 chars
 */
export const decodeTransferInput = (
  input: string
): { to: string; amount: bigint } | null => {
  if (input.length < 138) return null;

  // Handle both with and without 0x prefix for selector check
  const selector = input.startsWith("0x") ? input.slice(2, 10) : input.slice(0, 8);
  if (selector !== TRANSFER_SELECTOR) return null;

  const offset = input.startsWith("0x") ? 2 : 0;
  const to = "0x" + input.slice(offset + 32, offset + 72).toLowerCase();
  const amount = BigInt("0x" + input.slice(offset + 72, offset + 136));

  return { to, amount };
};

/**
 * Compute the explorer-compatible transaction hash.
 *
 * Hyperliquid uses a custom signature scheme for system transactions:
 * - Internal hash: r=0, s=0, v=chainId*2+35
 * - Explorer hash: r=1, s=from address, v=chainId*2+35+1
 *
 * @param tx - Transaction fields
 * @param fromAddress - System address used in explorer hash signature
 */
export const computeExplorerHash = (tx: {
  chainId: bigint;
  nonce: bigint;
  gasPrice: bigint;
  gas: bigint;
  to: string;
  value: bigint;
  input: string;
  from: string;
}): string => {
  const vExplorer = tx.chainId * 2n + 36n; // chainId*2+35+1

  const rlpExplorer = toRlp([
    tx.nonce === 0n ? "0x" : viemToHex(tx.nonce),
    tx.gasPrice === 0n ? "0x" : viemToHex(tx.gasPrice),
    viemToHex(tx.gas),
    tx.to.toLowerCase() as `0x${string}`,
    tx.value === 0n ? "0x" : viemToHex(tx.value),
    tx.input as `0x${string}`,
    viemToHex(vExplorer),
    "0x1", // r = 1
    tx.from.toLowerCase() as `0x${string}`, // s = from address
  ]);

  return keccak256(rlpExplorer);
};

/**
 * Compute both internal and explorer transaction hashes.
 *
 * @param tx - Transaction fields
 * @param fromAddress - System address used in explorer hash signature
 */
export const computeTxHashes = (tx: {
  chainId: bigint;
  nonce: bigint;
  gasPrice: bigint;
  gas: bigint;
  to: string;
  value: bigint;
  input: string;
}, fromAddress: string): { hash: string; explorerHash: string } => {
  // Internal hash: v=chainId*2+35, r=0, s=0
  const vInternal = tx.chainId * 2n + 35n;
  const rlpInternal = toRlp([
    tx.nonce === 0n ? "0x" : viemToHex(tx.nonce),
    tx.gasPrice === 0n ? "0x" : viemToHex(tx.gasPrice),
    viemToHex(tx.gas),
    tx.to.toLowerCase() as `0x${string}`,
    tx.value === 0n ? "0x" : viemToHex(tx.value),
    tx.input as `0x${string}`,
    viemToHex(vInternal),
    "0x", // r = 0
    "0x", // s = 0
  ]);
  const hash = keccak256(rlpInternal);

  // Explorer hash: v=chainId*2+35+1, r=1, s=from address
  const vExplorer = tx.chainId * 2n + 36n;
  const rlpExplorer = toRlp([
    tx.nonce === 0n ? "0x" : viemToHex(tx.nonce),
    tx.gasPrice === 0n ? "0x" : viemToHex(tx.gasPrice),
    viemToHex(tx.gas),
    tx.to.toLowerCase() as `0x${string}`,
    tx.value === 0n ? "0x" : viemToHex(tx.value),
    tx.input as `0x${string}`,
    viemToHex(vExplorer),
    "0x1", // r = 1
    fromAddress.toLowerCase() as `0x${string}`, // s = from address
  ]);
  const explorerHash = keccak256(rlpExplorer);

  return { hash, explorerHash };
};
