/**
 * A room's name, which is also its tenancy boundary.
 *
 * A Durable Object name resolves to exactly one instance globally, so **whoever chooses the name chooses which
 * data they see**. That makes this the most security-sensitive string in the realtime path, and the reason it is a
 * brand rather than a `string`: the only way to obtain a `RoomName` is to call a constructor here, and each one
 * takes an `OrgId` that came from a resolved session.
 *
 * A client therefore cannot name a room. It asks for "the queue" and the server decides which room that is — the
 * same argument `Db.scoped` makes for never accepting an `orgId` argument (ADR-0014).
 */
import type { OrgId } from "@ea/domain/Identity"
import { Schema } from "effect"

export const RoomName = Schema.String.pipe(Schema.brand("RoomName"))
export type RoomName = typeof RoomName.Type

/**
 * The organization's own socket room: one per tenant.
 *
 * One per tenant rather than one per chat room, and that is the decision that keeps this package free of a
 * subscribe protocol: every client of an organization is on one socket, and a frame carries whatever it needs to
 * say which room it concerns. It is also the shard boundary — a busy organization cannot slow another one down,
 * and Cloudflare is explicit that one object serving everybody is an anti-pattern (~500–1,000 requests per second
 * per object, `docs/references.md`).
 */
export const orgRoom = (orgId: OrgId): RoomName => RoomName.make(`org:${orgId}`)
