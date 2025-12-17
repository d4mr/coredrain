/**
 * HTTP API Server.
 *
 * Uses Effect HttpApiBuilder with Bun.serve for the HTTP server.
 * Provides OpenAPI spec and Scalar documentation via built-in middleware.
 *
 * ---
 * WHY EFFECT FOR HTTP?
 *
 * Fair question. For simple CRUD like this, Hono would be equally good.
 * We use Effect HttpApi because:
 * 1. Free OpenAPI generation from schemas (no manual spec maintenance)
 * 2. Type-safe error channel — if handler can fail with NotFoundError,
 *    it MUST be declared in the API definition or it won't compile
 * 3. Consistency with rest of codebase (everything is Effect)
 *
 * The tradeoff is more ceremony in handlers.ts. For this API size, it's
 * arguably overkill. But it's already built, and the type safety is nice.
 * ---
 */

import { HttpApiBuilder, HttpApiScalar, HttpServer } from "@effect/platform";
import { Layer } from "effect";
import { ApiLive } from "./handlers";

/** API port from environment or default */
const API_PORT = parseInt(process.env.API_PORT || "9465", 10);

/**
 * Start the API server. Call once at startup.
 *
 * This wires up:
 * - ApiLive (handlers from handlers.ts)
 * - OpenAPI middleware (serves /openapi.json)
 * - CORS middleware
 * - Scalar docs UI (serves /docs)
 *
 * Then wraps it all in a Bun.serve() call.
 */
export const startApiServer = (): void => {
  // Middleware layers that require Api context
  // (they need to introspect the API definition to generate OpenAPI spec)
  const MiddlewareLayers = Layer.mergeAll(
    HttpApiBuilder.middlewareOpenApi(),
    HttpApiBuilder.middlewareCors(),
    HttpApiScalar.layer({ path: "/docs" })
  );

  // Compose everything:
  // - ApiLive provides the actual handlers
  // - MiddlewareLayers.pipe(Layer.provide(ApiLive)) gives middleware access to API def
  // - HttpServer.layerContext provides request/response context
  const FullLayer = Layer.mergeAll(
    ApiLive,
    MiddlewareLayers.pipe(Layer.provide(ApiLive)),
    HttpServer.layerContext
  );

  // toWebHandler converts the Effect HttpApi into a standard fetch handler
  // that Bun (or any Web-compatible runtime) can use
  const { handler } = HttpApiBuilder.toWebHandler(FullLayer);

  // Start Bun server — this is the only imperative part
  Bun.serve({
    port: API_PORT,
    hostname: "0.0.0.0",
    fetch: (req) => handler(req),
  });

  console.log(`API server: http://localhost:${API_PORT}`);
  console.log(`
Endpoints:
  Transfers:
    GET  /transfers              - List (query: status, watchedAddress, user, token, limit, offset)
    GET  /transfers/:hash        - Get by any hash (hypercore, hyperevm, or explorer)
  
  Addresses:
    GET  /addresses              - List all with cursors
    POST /addresses              - Add (body: {"address": "0x..."})
    DELETE /addresses/:addr      - Deactivate
    POST /addresses/:addr/activate - Reactivate  
    POST /addresses/:addr/reset    - Re-index from scratch
  
  Stats:
    GET  /stats                  - System statistics (fast)
    GET  /health                 - Health check

  Docs:
    GET  /docs                   - Scalar API Reference UI
    GET  /openapi.json           - OpenAPI specification
`);
};
