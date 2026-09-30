/**
 * The authenticated caller's identity, as the wire sees it.
 *
 * Exists mainly to make the auth seam observable end to end: if `GET /api/v1/me` returns the
 * right organization for the right session, the middleware, the session lookup and the tenant
 * resolution are all working. A monitor or an integrating client can also use it to confirm a
 * token is valid without guessing at a business endpoint.
 */
import { Authenticated } from "@ea/domain/Identity"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"

export class MeV1 extends Schema.Class<MeV1>("MeV1")({
  user_id: Schema.String,
  email: Schema.String,
  /** The active organization. Every tenant-scoped query is attributed to this. */
  organization_id: Schema.String,
  role: Schema.Literals(["owner", "reviewer", "viewer"])
}) {}

/**
 * Endpoints requiring a session.
 *
 * `.middleware(Authenticated)` applies to the whole group, so adding an endpoint here cannot
 * accidentally be public — the default for this group is protected.
 */
export const MeGroup = HttpApiGroup.make("me")
  .add(HttpApiEndpoint.get("get", "/me", { success: MeV1 }))
  .middleware(Authenticated)
