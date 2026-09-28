/**
 * Who is acting, and which tenant they are acting in.
 *
 * `CurrentUser` is the org-scoping seam. Two properties make it load-bearing:
 *
 * 1. **It has no default.** A `Context.Service` without one means an effect that reads it
 *    carries `CurrentUser` in `R` until something provides it, so forgetting the
 *    authentication middleware is a compile error rather than a production incident.
 * 2. **No store method takes an `orgId` argument.** The org is read from here, never passed
 *    in — so a caller cannot name a tenant that is not theirs. If a query can be written
 *    without reaching this service, the seam has failed.
 */
import { Context, Schema } from "effect"

export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export const OrgId = Schema.String.pipe(Schema.brand("OrgId"))
export type OrgId = typeof OrgId.Type

/** A member's role within one organization. Closed set: an unknown role must not be guessable. */
export const MemberRole = Schema.Literals(["owner", "reviewer", "viewer"])
export type MemberRole = typeof MemberRole.Type

export class Identity extends Schema.Class<Identity>("Identity")({
  userId: UserId,
  orgId: OrgId,
  email: Schema.String,
  role: MemberRole
}) {}

/**
 * The authenticated actor for this request.
 *
 * Deliberately has no default value: absence must not type-check.
 */
export class CurrentUser extends Context.Service<CurrentUser, Identity>()("iam/CurrentUser") {}

/**
 * The tenant for non-interactive work — a queue consumer or a cron sweep, which has no session.
 *
 * A *different* tag from `CurrentUser` on purpose. If background work could satisfy
 * `CurrentUser`, a request handler could accidentally be satisfied by a worker-shaped identity,
 * and nobody could enumerate the non-interactive scopes. With two tags, `grep CurrentOrg` is
 * the complete list of places that act without a user.
 */
export class CurrentOrg extends Context.Service<CurrentOrg, OrgId>()("iam/CurrentOrg") {}
