/**
 * The versioned public API contract.
 *
 * One declaration types the server handlers, derives the OpenAPI document, and generates
 * the client — so docs cannot drift from the implementation. Everything under `/api/v1` is
 * frozen: endpoints may be added, never changed in place.
 */
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Authenticated } from "../../iam/Authenticated.ts"
import { HealthV1 } from "./Health.ts"
import { MeV1 } from "./Me.ts"

/** Liveness and capability reporting. Unauthenticated by design. */
export const HealthGroup = HttpApiGroup.make("health").add(
  // At rc.118 success/error are declared in the options object; the fluent
  // `.addSuccess()` of earlier versions no longer exists.
  HttpApiEndpoint.get("get", "/health", { success: HealthV1 })
)

/**
 * Endpoints requiring a session.
 *
 * `.middleware(Authenticated)` applies to the whole group, so adding an endpoint here cannot
 * accidentally be public — the default for this group is protected.
 */
export const MeGroup = HttpApiGroup.make("me")
  .add(HttpApiEndpoint.get("get", "/me", { success: MeV1 }))
  .middleware(Authenticated)

export const ApiV1 = HttpApi.make("effect-ai-v1")
  .add(HealthGroup)
  .add(MeGroup)
  .prefix("/api/v1")
