/**
 * Turn a `RoomRef` into a room row, creating a decision's thread on first use.
 *
 * Shared by every message operation, which is the point: a caller says which room it means and never has to
 * know whether that room exists yet. A decision's thread is created lazily because creating one eagerly would
 * mean a row for every decision anybody ever opened, most of which nobody ever writes in.
 *
 * **`create` is a parameter, and the asymmetry is deliberate.** Reading a thread that does not exist is not an
 * error — it is an empty thread — so `Message.list` passes `create: false` and gets `null`. Posting has to
 * create it, so `Message.post` passes `create: true`. The alternative, always creating, would have a reader
 * silently writing rows.
 */
import { RoomNotFound } from "@ea/modules/realtime/domain/Errors"
import { Room, type RoomId, type RoomRef } from "@ea/modules/realtime/domain/Room"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"

interface RoomRow {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly slug: string | null
  readonly topic: string | null
  readonly subject_id: string | null
  readonly created_by: string
  readonly created_at: Date
  readonly archived_at: Date | null
}

/**
 * `unreadCount` defaults to zero here, because most callers are not answering that question.
 *
 * `ResolveRoom`, `CreateRoom` and `ArchiveRoom` all return the room they just touched, where a count would be an
 * extra query for a number nobody is about to render. `ListRooms` computes it, and that is the one place the room
 * list is shown. A per-reader field on a shared entity is always going to be like this — see `mine` on a reaction.
 */
export const toRoom = (row: RoomRow, unreadCount = 0): Room =>
  new Room({
    id: row.id as RoomId,
    kind: row.kind as Room["kind"],
    name: row.name,
    slug: row.slug,
    topic: row.topic,
    subjectId: row.subject_id,
    createdBy: row.created_by as Room["createdBy"],
    createdAt: row.created_at.toISOString(),
    archivedAt: row.archived_at === null ? null : row.archived_at.toISOString(),
    unreadCount
  })

/** The columns every read of this table needs, in one place so the row type and the query cannot drift. */
export const ROOM_COLUMNS = "id, kind, name, slug, topic, subject_id, created_by, created_at, archived_at"

export const ResolveRoom = (ref: RoomRef, options: { readonly create: boolean }) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids

    const found = yield* db.scoped((sql, orgId) =>
      ref._tag === "RoomById"
        ? sql<RoomRow>`
            select ${sql.literal(ROOM_COLUMNS)} from rooms
             where organization_id = ${orgId} and id = ${ref.roomId}
          `
        : sql<RoomRow>`
            select ${sql.literal(ROOM_COLUMNS)} from rooms
             where organization_id = ${orgId} and kind = 'decision' and subject_id = ${ref.decisionId}
          `
    )

    const existing = found[0]
    if (existing !== undefined) return toRoom(existing)

    /*
     * A room addressed BY ID that does not exist is a refusal, never a creation. An id is something the caller
     * got from us; inventing a room for an unknown one would turn a typo into a new room.
     */
    if (ref._tag === "RoomById") return yield* Effect.fail(new RoomNotFound({ roomId: ref.roomId }))
    if (!options.create) return null

    const id = yield* ids.next
    /*
     * `on conflict do nothing`, against the partial unique index on (organization_id, subject_id).
     *
     * Two people opening the same decision and posting at the same moment both find nothing above and both
     * insert. Without this, one of them gets a constraint violation for doing something perfectly reasonable;
     * with it, the loser inserts nothing and re-reads below. That index is what makes a race recoverable
     * rather than two half-threads.
     *
     * (This comment is OUT here rather than inside the query because a backtick inside a `sql` template closes
     * it — the trap in AGENTS.md, which the error reports as `TS1005` pointing at a line of English.)
     */
    const created = yield* db.scoped((sql, orgId) =>
      sql<RoomRow>`
        insert into rooms (id, organization_id, kind, name, subject_id, created_by)
        values (${id}, ${orgId}, 'decision', 'Decision thread', ${ref.decisionId}, ${orgId})
        -- on conflict: see the comment above this query. Two people opening the same decision at the same
        -- moment both find nothing and both insert; the partial unique index makes that recoverable.
        on conflict do nothing
        returning ${sql.literal(ROOM_COLUMNS)}
      `
    )

    const inserted = created[0]
    if (inserted !== undefined) return toRoom(inserted)

    /*
     * Lost the race. The row exists now, put there by whoever won, so read it back rather than failing —
     * from the caller's point of view nothing unusual happened.
     */
    const reread = yield* db.scoped((sql, orgId) =>
      sql<RoomRow>`
        select ${sql.literal(ROOM_COLUMNS)} from rooms
         where organization_id = ${orgId} and kind = 'decision' and subject_id = ${ref.decisionId}
      `
    )
    const winner = reread[0]
    return winner === undefined
      // Neither inserted nor present: not a domain failure, so a defect rather than a typed error.
      ? yield* Effect.die(new Error("room insert conflicted but no row was found"))
      : toRoom(winner)
  })

/**
 * Narrower helper for callers that must have a room. Keeps the `null` branch out of every call site.
 *
 * The return type is inferred, not annotated. Annotating it here was wrong twice over — it claimed no error
 * channel and no requirements — and the Effect language service said so: `missingEffectError` and
 * `missingEffectContext`. Inference is also what the use cases next door do.
 */
export const ResolveRoomOrFail = (ref: RoomRef) =>
  Effect.flatMap(
    ResolveRoom(ref, { create: true }),
    (room) => room === null ? Effect.fail(new RoomNotFound({ roomId: "unresolved" })) : Effect.succeed(room)
  )
