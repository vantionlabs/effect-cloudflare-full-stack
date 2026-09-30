/**
 * Create a channel.
 *
 * Channels only: a decision's thread is created implicitly by posting in it (`ResolveRoom`), because a row per
 * decision anybody ever opened would mostly be empty.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { RoomNameInvalid, RoomSlugTaken } from "@ea/modules/realtime/domain/Errors"
import { MAX_ROOM_NAME_LENGTH, slugify } from "@ea/modules/realtime/domain/Room"
import { Effect } from "effect"
import { ROOM_COLUMNS, toRoom } from "./ResolveRoom.ts"

export const CreateRoom = (input: {
  readonly name: string
  readonly topic?: string | undefined
}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids
    const identity = yield* CurrentUser

    const name = input.name.trim()
    if (name === "" || name.length > MAX_ROOM_NAME_LENGTH) {
      return yield* Effect.fail(
        new RoomNameInvalid({ name: input.name, reason: `a name must be 1 to ${MAX_ROOM_NAME_LENGTH} characters` })
      )
    }

    const slug = slugify(name)
    if (slug === "") {
      /*
       * Refused rather than given a generated handle. A name of only emoji or punctuation slugifies to nothing,
       * and a channel nobody can address is a worse outcome than being told to pick a different name.
       */
      return yield* Effect.fail(
        new RoomNameInvalid({ name: input.name, reason: "a name must contain letters or numbers" })
      )
    }

    const id = yield* ids.next
    const rows = yield* db.scoped((sql, orgId) =>
      sql<{ id: string }>`
        insert into rooms (id, organization_id, kind, name, slug, topic, created_by)
        values (
          ${id}, ${orgId}, 'channel', ${name}, ${slug},
          ${input.topic === undefined || input.topic.trim() === "" ? null : input.topic.trim()},
          ${identity.userId}
        )
        on conflict do nothing
        returning id
      `
    )

    /*
     * No row means the partial unique index on (organization_id, slug) rejected it — the channel exists. A
     * typed refusal rather than a suffix: "#billing" and "#billing-2" are two places people post the same
     * thing, and inventing the second one chooses a confusing outcome on the user's behalf.
     */
    if (rows[0] === undefined) return yield* Effect.fail(new RoomSlugTaken({ slug }))

    const created = yield* db.scoped((sql, orgId) =>
      sql<never>`select ${sql.literal(ROOM_COLUMNS)} from rooms where organization_id = ${orgId} and id = ${id}`
    )
    const row = created[0]
    return row === undefined
      ? yield* Effect.die(new Error("created room could not be read back"))
      : toRoom(row)
  })
