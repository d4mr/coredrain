/**
 * Application configuration.
 *
 * Environment variables are loaded via Effect's Config system.
 * Constants that don't change between deployments are hardcoded.
 */

import { Config, Context, Effect, Layer, Redacted } from "effect";

/**
 * S3 credentials configuration - loaded via Effect Config.
 * These are sensitive and required for S3 block fetching.
 */
export const S3ConfigSchema = Config.all({
  accessKeyId: Config.redacted("S3_ACCESS_KEY_ID"),
  secretAccessKey: Config.redacted("S3_SECRET_ACCESS_KEY"),
});

/** Type of loaded S3 config */
export type S3ConfigType = Config.Config.Success<typeof S3ConfigSchema>;

/**
 * S3 configuration service tag.
 * Used to inject S3 credentials into services that need them.
 */
export class S3Config extends Context.Tag("S3Config")<
  S3Config,
  {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  }
>() {}

/**
 * S3 configuration layer - loads credentials from environment.
 */
export const S3ConfigLive = Layer.effect(
  S3Config,
  Effect.gen(function* () {
    const cfg = yield* S3ConfigSchema;
    return {
      accessKeyId: Redacted.value(cfg.accessKeyId),
      secretAccessKey: Redacted.value(cfg.secretAccessKey),
    };
  })
);

/**
 * Application configuration loaded from environment variables.
 * Non-sensitive values that can be loaded at startup.
 */
export const AppConfigSchema = Config.all({
  mongodb: Config.string("MONGODB_URL").pipe(
    Config.withDefault("mongodb://127.0.0.1:27017/coredrain")
  ),

  // Addresses to watch for outgoing spot transfers (comma-separated) 
  watchedAddresses: Config.array(Config.string(), "WATCHED_ADDRESSES").pipe(
    Config.withDefault([
      "0x30d83d444e230f652e2c62cb5697c8dad503987b",
      "0x4f0a01badaa24f762cee620883f16c4460c06be0",
      "0xfacc5b022641e9905ba3bac29b26e6d6191f2b8b",
      "0x97e7d0c24d485aa07e8218528f8dfcd00ac63f75",
    ])
  ),
});

// Type of the loaded application config 
export type AppConfigType = Config.Config.Success<typeof AppConfigSchema>;

// Application configuration service tag.
export class AppConfig extends Context.Tag("AppConfig")<
  AppConfig,
  AppConfigType
>() {}

// Application configuration layer.
export const AppConfigLive = Layer.effect(
  AppConfig,
  Config.unwrap(AppConfigSchema)
);

// ============================================================================
// Constants (hardcoded - these don't change between deployments)
// ============================================================================

// S3 bucket for HyperEVM blocks (Hyperliquid's public bucket, requester pays)
export const S3_BUCKET = "hl-mainnet-evm-blocks";

// S3 region for HyperEVM blocks
export const S3_REGION = "ap-northeast-1";

// How often to poll HyperCore for new transfers (ms)
export const CORE_INDEXER_POLL_MS = 30_000;

// Batch size for fetching pending transfers from DB
export const EVM_MATCHER_BATCH_SIZE = 256;

// Number of concurrent workers for EVM matching
export const EVM_MATCHER_CONCURRENCY = 256;

// Max RPC calls per batch request
export const MAX_BATCH_SIZE = 20;

// Threshold of pending transfers to switch from RPC to S3 backfill
export const BACKFILL_THRESHOLD = 10;

// ============================================================================
// System Addresses (Hyperliquid protocol constants)
// ============================================================================

/** HYPE native token system address (used in HyperCore API and as "from" for explorer hash) */
export const HYPE_SYSTEM_ADDRESS = "0x2222222222222222222222222222222222222222";

/** System address prefix for spot tokens (followed by 3-char hex index) */
export const SPOT_SYSTEM_PREFIX = "0x2000000000000000000000000000000000000";
