# Coredrain
A service that correlates HyperCore spot transfers with their HyperEVM transaction hashes.


![Coredrain Explorer](https://github.com/user-attachments/assets/12077e09-b2e0-48f8-bee1-ebe8191516b6)
<p align="center">
  <img src="https://github.com/user-attachments/assets/6fa4066e-3f0d-4e32-8198-652dc0d5d5b9" width="49%" alt="Grafana Dashboard" />
  <img src="https://github.com/user-attachments/assets/c795a2a9-31d5-4136-8cbd-59f6fb33119a" width="49%" alt="Explorer" />
</p>
<p align="center">
  <img src="https://github.com/user-attachments/assets/3d97a07c-9d60-450f-b70a-54d3a93b4bcd" width="49%" alt="Explorer Populating" />
  <img src="https://github.com/user-attachments/assets/07426e65-ae61-4090-a000-41275187afc7" width="49%" alt="API Reference" />
</p>


## The Problem

Hyperliquid has two execution environments running in parallel:

1. **HyperCore** - Hyperliquid's custom high-performance trading engine
2. **HyperEVM** - A standard EVM compatibility layer

When tokens move from HyperCore to HyperEVM (bridging), a transaction happens on HyperCore that triggers a corresponding "system transaction" on HyperEVM. The problem is: **these two transactions have different hashes**, and there's no built-in way to correlate them.

If you're building something that needs to show users their EVM transaction hash (for block explorers, receipts, etc.), you need to find the matching HyperEVM transaction for each HyperCore transfer. That's what Coredrain does.

## What It Does

1. Watches specific addresses for outgoing spot transfers on HyperCore
2. Finds the corresponding HyperEVM transaction for each transfer
3. Stores both hashes so you can look up either one

The correlation is based on matching:
- The system address (identifies which token)
- The recipient address
- The token amount (in EVM decimals)
- The approximate timestamp (HyperCore timestamp guides the search window)

## Why Not Just Index the Full Chain?

Good question. There are simpler approaches I considered:

### Option A: Full Chain Index
Index every single HyperEVM block and transaction, then query by (recipient, amount, time).

**Problem**: HyperEVM produces a block roughly every second. That's ~31 million blocks per year. Each block can have multiple system transactions. You'd need to store and index everything just to answer queries about a handful of addresses.

### Option B: Subscribe to Events
Watch for transfer events in real-time as they happen.

**Problem**: You miss historical data. If you start the service today, you can't correlate transfers from last month. Also, if your service goes down, you lose that window of data.

### What Coredrain Does Instead: Lazy Indexing

We only index what we need, when we need it:

1. **Track only watched addresses** - We don't care about every address on the chain, just the ones you configure
2. **Search on demand** - When a new HyperCore transfer comes in, we search for its EVM counterpart using a smart algorithm
3. **Cache what we fetch** - Every block we fetch during a search gets stored, making future searches faster
4. **Build up a targeted index** - Over time, the cache fills with exactly the blocks we care about

It's like building a search index incrementally as queries come in, instead of indexing the entire internet upfront.

### Tradeoffs

The lazy approach means **new wallets have correlation latency**. When you add a wallet with historical transfers, they don't correlate instantly, the matcher needs to search for each one. This takes time.

I've benchmarked the matcher at sustained ~150 transfers/sec with S3, and it gets faster as the cache grows:
- **Cache hits**: If a block was fetched for a previous search, we don't fetch it again
- **Better interpolation**: More cached blocks means tighter bounds for the binary search, fewer rounds needed

For steady-state operation (new transfers arriving in real-time), correlation is nearly instant since we're only searching recent blocks. The latency only matters during initial backfill of historical data.

If we need instant correlation for historical transfers, we'd need to pre-index the full chain. That's a different architecture with different cost tradeoffs.

## Why S3 for Block Data?

Hyperliquid provides an S3 bucket (`hl-mainnet-evm-blocks`) with all historical EVM block data. We use two strategies:

| Strategy | Speed           | Cost              | Use Case                     |
| -------- | --------------- | ----------------- | ---------------------------- |
| **RPC**  | ~2 blocks/sec   | Free              | Live matching (steady state) |
| **S3**   | ~370 blocks/sec | AWS data transfer | Backfill (catching up)       |

The service automatically switches between them:
- If there are >10 pending transfers, use S3 (fast bulk processing)
- Otherwise, use RPC (free, good enough for real-time)

S3 is 180x faster because we bypass the RPC rate limits and fetch raw block files directly. The data is LZ4-compressed MessagePack, which Bun handles efficiently with native bindings.

> **Note**: Bun's native S3 client (`Bun.s3`) would provide a ~20x improvement in performance (from ~150 blocks/sec to ~3000 blocks/sec based on their 7k files/sec benchmarks). However, `Bun.s3` does not currently support "requester pays" buckets, which Hyperliquid requires. I have submitted a PR to add support: https://github.com/oven-sh/bun/pull/25514

## The Search Algorithm

Finding an EVM transaction from a HyperCore transfer is essentially: "find a needle in a ~10 million block haystack, given only an approximate timestamp."

We use **binary search with interpolation**:

```
1. Start with bounds: [block 1, latest block]
2. Look up anchor points (blocks with known timestamps) from our cache
3. Interpolate: if target time is 30% between anchor times, estimate block 30% between anchor blocks
4. Fetch 5 blocks around the estimate
5. If found, done. If not:
   - Blocks found were before target time, then tighten the lower bound
   - Blocks found were after target time, then tighten the upper bound
6. Repeat with tighter bounds (max 20 rounds)
```

In practice, this finds most transactions in 2-4 rounds (~10-20 blocks fetched). The key insight is that every block we fetch becomes an anchor for future searches, so the cache gets more accurate over time. Also the number of rounds consistently goes down as we get a denser cache.

### Why Not Just Query by Timestamp?

HyperEVM doesn't have a "get blocks in time range" API. You can only query by block number. So we need to map timestamps to block numbers, which requires knowing the block production rate (not constant) and having reference points.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Main Sync Loop (30s)                       │
│   Reconciles FiberMap workers with MongoDB watched_addresses    │
└─────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │  Worker A   │    │  Worker B   │    │  Worker C   │
    │  Backfill → │    │  Polling    │    │  Backfill → │
    │  Poll       │    │  (30s)      │    │  Poll       │
    └─────────────┘    └─────────────┘    └─────────────┘
           │                  │                  │
           └──────────────────┼──────────────────┘
                              ▼
                    ┌─────────────────┐
                    │ Shared Backoff  │
                    │ (reactive 429)  │
                    └─────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │   Matcher   │    │   Matcher   │    │   Matcher   │
    │  Worker 1   │    │  Worker 2   │    │  Worker N   │
    └─────────────┘    └─────────────┘    └─────────────┘
```

### Core Indexer (FiberMap Workers)

Each watched address gets its own worker fiber:
- **Backfill phase**: Fetch all historical transfers as fast as possible
- **Poll phase**: Check for new transfers every 30 seconds

Workers are independent, so a slow address doesn't block others. The FiberMap pattern lets us add/remove addresses dynamically without restarting.

### EVM Matcher (Worker Pool)

A bounded queue with N workers (256 for S3, 10 for RPC):
- Producer fetches pending transfers from MongoDB
- Workers pull from queue and search for matches
- Backpressure: producer blocks when queue is full

### Rate Limit Handling

Instead of proactive rate limiting (token bucket), we use reactive backoff:
- When any worker hits HTTP 429, ALL workers pause
- This prevents the "thundering herd" problem
- No wasted capacity from conservative limits

### Scaling Beyond a Single Instance

The current architecture runs as a single process, which is sufficient for the use case (a handful of watched addresses). However, horizontal scaling would be straightforward to add:

1. **Indexer**: Already scales naturally - each instance could claim a subset of watched addresses using MongoDB's `findOneAndUpdate` with a lease timestamp. Addresses would be partitioned across instances automatically.

2. **Matcher**: Replace the in-memory queue with a distributed work queue (Redis, SQS, or MongoDB capped collection). Workers across instances would claim pending transfers atomically using `findOneAndUpdate` with a `claimedAt` timestamp and TTL for fault tolerance.

3. **Deduplication**: Already handled by the unique index on `hypercoreHash` which ensures idempotent inserts, regardless of how many instances are processing the same data.

Multi-instance horizontal scaling is beyond the scope of the current implementation, but the data model supports it without schema changes.

## Why Effect?

The codebase uses [Effect](https://effect.website/) for programming with typed errors and concurrency. Here's why:

### What Effect Gives Us

**1. Typed Errors**

```typescript
// Every function declares what can go wrong
export const findEvmHash = (...): Effect.Effect<FindResult, NotFoundError | Error>

// Errors are values, not exceptions - you handle them explicitly
yield* findEvmHash(transfer).pipe(
  Effect.catchTag("NotFoundError", (e) => markFailed(e.blocksSearched))
)
```

Traditional try/catch has no types - you never know what a function might throw. Effect makes errors first-class.

**2. Concurrency Primitives**

```typescript
// FiberMap: keyed concurrent workers
const workers = yield* FiberMap.make<string>()
yield* FiberMap.run(workers, address, runWorker(address))

// Bounded queue with backpressure
const queue = yield* Queue.bounded<Transfer>(256)
yield* Queue.offer(queue, transfer)  // blocks if full

// Ref: thread-safe mutable state
const backoffUntil = yield* Ref.make(0)
yield* Ref.update(backoffUntil, (prev) => Math.max(prev, Date.now() + 5000))
```

These are hard to get right with raw Promises/async-await.

**3. Structured Concurrency**

```typescript
// All fibers are automatically cleaned up on shutdown
const main = Effect.gen(function* () {
  const f1 = yield* Effect.fork(runIndexer)
  const f2 = yield* Effect.fork(runMatcher)
  yield* Fiber.joinAll([f1, f2])  // wait for all
}).pipe(
  Effect.ensuring(disconnectDatabase)  // guaranteed cleanup
)
```

No dangling promises, no forgotten cleanup handlers.

**4. Composability**

```typescript
// Effects compose cleanly
const processTransfer = pipe(
  findEvmHash(transfer),
  Effect.timeout(Duration.seconds(30)),
  Effect.retry(Schedule.exponential(Duration.seconds(1))),
  Effect.catchAll(handleError)
)
```

Compare to nested try/catch/finally with manual timeout handling.

### The Tradeoffs

**Learning Curve**: Effect is different from typical TypeScript. Generators (`yield*`), the Effect type, and the functional style take time to learn.

**Verbosity**: Some patterns are more verbose than raw async/await:
```typescript
// Async/await
const result = await doSomething()

// Effect
const result = yield* Effect.tryPromise({
  try: () => doSomething(),
  catch: (e) => new MyError(e)
})
```

### Is It Worth It?

For simpler projects, a lightweight Either-based implementation (like [fp-ts](https://gcanti.github.io/fp-ts/) or a minimal `Left`/`Right` pattern) would suffice for typed error handling. However, this indexer has requirements that benefit from Effect's additional primitives:

- **Concurrency**: FiberMap for per-address workers, bounded queues with backpressure, shared backoff state across workers
- **Structured cleanup**: Guaranteed resource cleanup on shutdown (DB connections, pending operations)
- **Cancellation**: Long-running searches can be interrupted cleanly

The core insight is the same as any Either-based approach: errors are values in the type signature, not thrown exceptions. Effect just adds the concurrency and resource management layers on top.

For simpler scripts or CRUD apps? A minimal Either implementation is probably the right choice.

## System Addresses

When tokens bridge from HyperCore to HyperEVM, they go through special system addresses:

| Token         | System Address                                   | Transfer Type                     |
| ------------- | ------------------------------------------------ | --------------------------------- |
| HYPE (native) | `0x2222222222222222222222222222222222222222`     | Native ETH transfer (`msg.value`) |
| Spot tokens   | `0x2000000000000000000000000000000000000{index}` | ERC20 `transfer()` call           |

The index is a hex suffix. For example, token index 222 (0xDE in hex) becomes `0x20000000000000000000000000000000000000de`.

### Decimal Handling

HyperCore and HyperEVM can have different decimal precision for the same token:
```
EVM decimals = weiDecimals + evm_extra_wei_decimals
```

HYPE is always 18 decimals. Spot tokens vary - USDC is 6, some tokens use 18. We fetch this from the `spotMeta` API and cache it.

## MongoDB Collections

| Collection          | Purpose                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| `transfers`         | Indexed transfers with matching status                                                  |
| `watched_addresses` | Address list with per-address cursors                                                   |
| `system_txs`        | Cached EVM system transactions (also used as anchor points for timestamp interpolation) |

The `transfers` and `system_txs` collections are intentionally separate. Transfers represent "things we care about" from HyperCore (watched addresses). SystemTransactions are a cache of ALL system txs we've seen on HyperEVM during searches. A single block might have 10 system txs but we only need 1 for our transfer. The other 9 still get cached for future searches and provide anchor points for block estimation.

### Transfer Document

```javascript
{
  // HyperCore side
  hypercoreHash: "0x...",
  hypercoreTime: 1700000000000,  // ms
  token: "HYPE",
  amount: "100.5",
  user: "0x...",          // recipient
  systemAddress: "0x222...",
  watchedAddress: "0x...", // sender we're tracking
  
  // HyperEVM side (null until matched)
  hyperevmHash: "0x...",
  hyperevmExplorerHash: "0x...",  // different hash format
  hyperevmBlock: 5500000,
  hyperevmBlockHash: "0x...",
  hyperevmTime: 1700000000000,
  
  status: "pending" | "matched" | "failed",
  failReason: null | "Not found after 200 blocks"
}
```

### SystemTx Document

```javascript
{
  hash: "0x...",           // internal hash (r=0, s=0)
  explorerHash: "0x...",   // explorer hash (r=1, s=from)
  blockNumber: 5500000,
  blockHash: "0x...",
  blockTimestamp: 1700000000000,  // ms
  
  // Matching fields (normalized so HYPE and ERC20 look the same)
  from: "0x222...",        // system address (tx.from)
  assetRecipient: "0x...", // user receiving the asset
  amountWei: "100500000000000000000",  // amount in smallest units
  contractAddress: "0x..." | null      // ERC20 contract, null for HYPE
}
```

Note on field naming: we use `assetRecipient` and `amountWei` instead of `to` and `value` because those mean different things for HYPE vs ERC20 transfers. For HYPE, `tx.to` is the user and `tx.value` is the amount. For ERC20, `tx.to` is the contract address and `tx.value` is 0 (the actual recipient and amount are in the calldata). By normalizing to `assetRecipient` and `amountWei`, the matching logic doesn't need to care which type it is.

### Why Two EVM Hashes?

HyperEVM system transactions have two valid hash formats:
- **Internal hash**: Uses `r=0, s=0` in the signature (how Hyperliquid computes it internally)
- **Explorer hash**: Uses `r=1, s=from_address` (what block explorers show)

We store both so you can look up a transfer by either hash.

## API

The service exposes an HTTP API on port 9465:

### Transfers

```bash
# List transfers (with filters)
GET /transfers?status=pending&watchedAddress=0x...&limit=100&offset=0

# Get by any hash (hypercore, hyperevm, or explorer)
GET /transfers/0x...
```

### Addresses (Admin)

```bash
# List all watched addresses
GET /addresses

# Add new address
POST /addresses
{"address": "0x..."}

# Deactivate (stops indexing, keeps data)
DELETE /addresses/0x...

# Reactivate
POST /addresses/0x.../activate

# Re-index from scratch
POST /addresses/0x.../reset
```

### Stats

```bash
GET /stats
GET /health
```

## Metrics

Prometheus metrics on port 9464:

| Metric                                   | Type      | Description                                |
| ---------------------------------------- | --------- | ------------------------------------------ |
| `coredrain_transfers_processed_total`    | Counter   | Processed transfers by status and strategy |
| `coredrain_transfers_pending`            | Gauge     | Current pending count                      |
| `coredrain_match_duration_seconds`       | Histogram | Time to match a transfer                   |
| `coredrain_match_rounds`                 | Histogram | Search rounds per match                    |
| `coredrain_match_blocks_searched`        | Histogram | Blocks fetched per match                   |
| `coredrain_block_fetch_duration_seconds` | Histogram | Block fetch latency by strategy            |

## Running

### Prerequisites

- [Bun](https://bun.sh/) runtime
- MongoDB 6+
- AWS credentials (for S3 block fetching)

### Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Set up environment (copy and edit with your AWS credentials)
cp .env.example .env

# 3. Start MongoDB (if not running)
docker run -d -p 27017:27017 mongo:7

# 4. Run the service
bun run src/main.ts
```

### AWS Credentials

S3 credentials are **required** for block fetching. The service uses Hyperliquid's public S3 bucket (`hl-mainnet-evm-blocks`) which is "requester pays", meaning you need valid AWS credentials (any AWS account works, you just pay for data transfer).

To get credentials:
1. Create an AWS account (or use existing)
2. Go to IAM → Users → Create user
3. Create access key for programmatic access
4. Add to `.env` file or pass via environment

Without S3, the service cannot fetch historical block data and will fail to start.

### Development

```bash
bun install
bun run src/main.ts

# With debug logging
LOG_LEVEL=debug bun run src/main.ts
```

### Docker

```bash
# Set S3 credentials in environment first
export S3_ACCESS_KEY_ID=your_key
export S3_SECRET_ACCESS_KEY=your_secret

docker-compose up
```

This starts:
- Coredrain service
- MongoDB
- Prometheus (scrapes metrics)
- Grafana (dashboard on port 3000)

### Local URLs

| Service          | URL                                                   | Description                                          |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| **UI**           | http://localhost:5173                                 | Web interface for browsing transfers. (AI GENERATED) |
| **API Docs**     | http://localhost:9465/docs                            | Scalar OpenAPI reference UI                          |
| **OpenAPI Spec** | http://localhost:9465/openapi.json                    | Raw OpenAPI JSON                                     |
| **Grafana**      | http://localhost:3000/d/coredrain-dashboard/coredrain | Metrics dashboard                                    |
| **Prometheus**   | http://localhost:9090                                 | Metrics backend                                      |
| **API**          | http://localhost:9465                                 | REST API                                             |
| **Metrics**      | http://localhost:9464/metrics                         | Prometheus scrape endpoint                           |


### Environment Variables

| Variable               | Default                               | Description                            |
| ---------------------- | ------------------------------------- | -------------------------------------- |
| `MONGODB_URL`          | `mongodb://127.0.0.1:27017/coredrain` | MongoDB connection                     |
| `LOG_LEVEL`            | `warn`                                | debug/info/warn/error                  |
| `METRICS_PORT`         | `9464`                                | Prometheus metrics port                |
| `API_PORT`             | `9465`                                | HTTP API port                          |
| `S3_ACCESS_KEY_ID`     | (none)                                | AWS credentials for Hyperliquid bucket |
| `S3_SECRET_ACCESS_KEY` | (none)                                | AWS credentials for Hyperliquid bucket |

## Tests

```bash
bun test
```

Tests include:
- Finder algorithm with real matched transfer fixtures
- Block estimation/interpolation
- Utility functions (address parsing, amount conversion)
- Asset cache initialization

## Code Style

The codebase follows these conventions:

### Effect Patterns

- Use `Effect.gen(function* () { ... })` for sequential async operations
- Wrap Promise APIs with `Effect.tryPromise`
- Use `Data.TaggedError` for typed errors with `_tag` discriminator
- Prefer `Effect.catchTag` over generic catch-all

### File Organization

```
src/
├── api/           # External API clients (HyperCore, HyperEVM, HTTP routes)
├── cache/         # In-memory caches (assets, anchors)
├── lib/           # Utilities and error types
├── models/        # MongoDB models with Effect-wrapped operations
├── services/      # Core business logic (indexer, matcher, finder)
├── strategies/    # Block fetching implementations (RPC, S3)
├── config.ts       # Configuration constants
├── metrics.ts     # Prometheus metrics
└── main.ts        # Entry point
```

### Naming

- Effects that run forever: `runXxxService`
- Effects that return data: `getXxx`, `findXxx`
- Effects that modify state: `insertXxx`, `updateXxx`, `markXxx`
- Error classes: `XxxError` extending `Data.TaggedError`

## License

MIT
