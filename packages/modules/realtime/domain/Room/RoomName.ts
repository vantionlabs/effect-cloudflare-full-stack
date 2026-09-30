/**
 * A room's name, which is also its tenancy boundary.
 *
 * A Durable Object name resolves to exactly one instance globally, so **whoever chooses the name chooses
 * which data they see**. That makes this the most security-sensitive string in the realtime path, and the
 * reason it is a brand rather than a `string`: the only way to obtain a `RoomName` is to call a constructor
 * here, and each one takes an `OrgId` that came from a resolved session.
 *
 * A client therefore cannot name a room. It asks for "the queue" and the server decides which room that is
 * — the same argument `Db.scoped` makes for never accepting an `orgId` argument (ADR-0014). If a handler is
 * ever tempted to read a room name from a query parameter, the brand makes that a compile error rather than
 * a cross-tenant read.
 */
import type { OrgId } from "@ea/domain/Identity"
import { Schema } from "effect"

export const RoomName = Schema.String.pipe(Schema.brand("RoomName"))
export type RoomName = typeof RoomName.Type

/**
 * The organization's own room: queue changes and presence.
 *
 * One per tenant rather than one per user, because the point is that members see each other. It is also the
 * shard boundary — a busy organization cannot slow another one down, and Cloudflare is explicit that one
 * object serving everybody is an anti-pattern, with a ceiling around 500–1,000 requests per second to go
 * with it (`docs/references.md`).
 *
 * **A per-decision room will be a second constructor here** when threads land (issue 05), and its subject
 * id will be a plain `string` rather than a `DecisionId` — importing that brand would make `shared` depend
 * on the `decision` slice and invert the direction the whole layout rests on. `Terminal.ts` names other
 * slices' error tags as strings for exactly the same reason.
 */
export const orgRoom = (orgId: OrgId): RoomName => RoomName.make(`org:${orgId}`)
