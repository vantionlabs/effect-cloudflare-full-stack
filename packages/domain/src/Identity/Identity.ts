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
import { Context, Effect, Layer, Schema } from "effect"

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
 * The tenant. **This is the tenancy requirement for almost everything.**
 *
 * A *different* tag from `CurrentUser` on purpose, and the direction of the relationship is the point:
 * `CurrentUser` *implies* `CurrentOrg` (see `CurrentOrgFromUser`), never the reverse. Background work has
 * no session and can never satisfy `CurrentUser`, so a request handler cannot accidentally be satisfied by
 * a worker-shaped identity.
 *
 * **Which tag a use case should require.** The weaker one it can get away with:
 *
 *   `CurrentOrg`   it needs to know WHICH TENANT. Almost everything — decide, retrieve, emit, consume.
 *   `CurrentUser`  it needs to know WHICH PERSON. Recording `approved_by`, reading "my" queue, anything
 *                  whose answer differs between two members of the same organization.
 *
 * Requiring `CurrentUser` where `CurrentOrg` would do is a real cost, not a style preference: it makes the
 * use case unreachable from a queue or a cron, which is how the decide pipeline came to be unrunnable in
 * the deployed Worker (docs/services.md §3.1).
 *
 * **The audit question, and how it is answered now.** It used to be "grep CurrentOrg". That worked while
 * nothing required it; once shared use cases do, the complete list of places acting without a user is
 * where `CurrentOrg` is **provided directly** rather than derived:
 *
 *   rg "provideService\(CurrentOrg|CurrentOrg\.context"     ← non-interactive entry points
 *   rg "CurrentOrgFromUser"                                 ← the interactive ones, via a session
 *
 * The first list should stay very short: the queue consumer and the cron, and nothing else.
 */
export class CurrentOrg extends Context.Service<CurrentOrg, OrgId>()("iam/CurrentOrg") {}

/**
 * Derives `CurrentOrg` from an authenticated session.
 *
 * The only bridge between the two tags, and it points one way. There is deliberately no
 * `CurrentUserFromOrg`: a tenant does not imply a person, and inventing one would put a synthetic
 * identity into an audit column.
 */
export const CurrentOrgFromUser: Layer.Layer<CurrentOrg, never, CurrentUser> = Layer.effect(CurrentOrg)(
  Effect.map(CurrentUser, (identity) => identity.orgId)
)
