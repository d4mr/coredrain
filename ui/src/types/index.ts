export type TransferStatus = "pending" | "matched" | "failed";

export interface Transfer {
  _id: string;
  // HyperCore side
  hypercoreHash: string;
  hypercoreTime: number;
  token: string;
  amount: string;
  usdcValue: string | null;
  fee: string | null;
  nativeTokenFee: string | null;
  user: string;
  systemAddress: string;
  watchedAddress: string;
  // HyperEVM side (null until matched)
  hyperevmHash: string | null;
  hyperevmExplorerHash: string | null;
  hyperevmBlock: number | null;
  hyperevmBlockHash: string | null;
  hyperevmTime: number | null;
  contractAddress: string | null;
  // Status
  status: TransferStatus;
  failReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransfersResponse {
  data: Transfer[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface WatchedAddress {
  address: string;
  lastIndexedTime: number;
  isActive: boolean;
}

export interface AddressesResponse {
  data: WatchedAddress[];
}

export interface Stats {
  transfers: {
    total: number;
    pending: number;
    matched: number;
    failed: number;
  };
  addresses: {
    total: number;
    active: number;
  };
  blocks: {
    stored: number;
    oldestBlock: number | null;
    newestBlock: number | null;
  };
}

export interface StatsResponse extends Stats {}

// Hyperliquid Spot Token
export interface SpotToken {
  name: string;
  szDecimals: number;
  weiDecimals: number;
  index: number;
  tokenId: string;
  isCanonical: boolean;
  evmContract: {
    address: string;
    evm_extra_wei_decimals: number;
  } | null;
  fullName: string | null;
}

export interface SpotMetaResponse {
  tokens: SpotToken[];
}
