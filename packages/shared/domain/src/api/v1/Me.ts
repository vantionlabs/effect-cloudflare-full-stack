/**
 * The authenticated caller's identity, as the wire sees it.
 *
 * Exists mainly to make the auth seam observable end to end: if `GET /api/v1/me` returns the
 * right organization for the right session, the middleware, the session lookup and the tenant
 * resolution are all working. A monitor or an integrating client can also use it to confirm a
 * token is valid without guessing at a business endpoint.
 */
import { Schema } from "effect"

export class MeV1 extends Schema.Class<MeV1>("MeV1")({
  user_id: Schema.String,
  email: Schema.String,
  /** The active organization. Every tenant-scoped query is attributed to this. */
  organization_id: Schema.String,
  role: Schema.Literals(["owner", "reviewer", "viewer"])
}) {}
