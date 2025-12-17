/**
 * Coredrain HTTP API Definition.
 *
 * Uses @effect/platform HttpApi for type-safe API definition.
 * This file defines the API structure, endpoints, and their schemas.
 */

import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "@effect/platform";
import {
  PaginatedTransfersResponse,
  SingleTransferResponse,
  TransferFilterParams,
  AddressesListResponse,
  AddAddressRequest,
  AddAddressResponse,
  AddressActionResponse,
  SystemStatsResponse,
  HealthResponse,
  NotFoundError,
  ValidationError,
  DatabaseError,
  AnyHash,
  EthAddress,
} from "./schemas";

// ============================================================================
// API Endpoint Definitions
// ============================================================================

// Path parameter schemas
const HashParam = HttpApiSchema.param("hash", AnyHash);
const AddressParam = HttpApiSchema.param("address", EthAddress);

/**
 * Transfers API Group.
 * Endpoints for querying transfers.
 */
const TransfersGroup = HttpApiGroup.make("transfers")
  // GET /transfers - List transfers with pagination and filtering
  .add(
    HttpApiEndpoint.get("list", "/transfers")
      .setUrlParams(TransferFilterParams)
      .addSuccess(PaginatedTransfersResponse)
      .addError(DatabaseError, { status: 500 })
  )
  // GET /transfers/:hash - Get transfer by any hash
  .add(
    HttpApiEndpoint.get("getByHash")`/transfers/${HashParam}`
      .addSuccess(SingleTransferResponse)
      .addError(NotFoundError, { status: 404 })
      .addError(DatabaseError, { status: 500 })
  )
  .prefix("/");

/**
 * Addresses API Group.
 * Endpoints for managing watched addresses.
 */
const AddressesGroup = HttpApiGroup.make("addresses")
  // GET /addresses - List all watched addresses
  .add(
    HttpApiEndpoint.get("list", "/addresses")
      .addSuccess(AddressesListResponse)
      .addError(DatabaseError, { status: 500 })
  )
  // POST /addresses - Add new address
  .add(
    HttpApiEndpoint.post("add", "/addresses")
      .setPayload(AddAddressRequest)
      .addSuccess(AddAddressResponse)
      .addError(ValidationError, { status: 400 })
      .addError(DatabaseError, { status: 500 })
  )
  // DELETE /addresses/:address - Deactivate address
  .add(
    HttpApiEndpoint.del("deactivate")`/addresses/${AddressParam}`
      .addSuccess(AddressActionResponse)
      .addError(NotFoundError, { status: 404 })
      .addError(DatabaseError, { status: 500 })
  )
  // POST /addresses/:address/activate - Activate address
  .add(
    HttpApiEndpoint.post("activate")`/addresses/${AddressParam}/activate`
      .addSuccess(AddressActionResponse)
      .addError(NotFoundError, { status: 404 })
      .addError(DatabaseError, { status: 500 })
  )
  // POST /addresses/:address/reset - Reset address for re-indexing
  .add(
    HttpApiEndpoint.post("reset")`/addresses/${AddressParam}/reset`
      .addSuccess(AddressActionResponse)
      .addError(NotFoundError, { status: 404 })
      .addError(DatabaseError, { status: 500 })
  )
  .prefix("/");

/**
 * Stats API Group.
 * Endpoints for system statistics and health checks.
 */
const StatsGroup = HttpApiGroup.make("stats")
  // GET /stats - System statistics
  .add(
    HttpApiEndpoint.get("stats", "/stats")
      .addSuccess(SystemStatsResponse)
      .addError(DatabaseError, { status: 500 })
  )
  // GET /health - Health check
  .add(
    HttpApiEndpoint.get("health", "/health")
      .addSuccess(HealthResponse)
      .addError(DatabaseError, { status: 500 })
  )
  .prefix("/");

// ============================================================================
// Complete API Definition
// ============================================================================

/**
 * The complete Coredrain API.
 * Combines all endpoint groups into a single API definition.
 */
export class CoredrainApi extends HttpApi.make("coredrain")
  .add(TransfersGroup)
  .add(AddressesGroup)
  .add(StatsGroup)
  .annotate(OpenApi.Title, "Coredrain API")
  .annotate(OpenApi.Version, "1.0.0")
  .annotate(OpenApi.Description, "HyperCore to HyperEVM transfer correlator API") {}
