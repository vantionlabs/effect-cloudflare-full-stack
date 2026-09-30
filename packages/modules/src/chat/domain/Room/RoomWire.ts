/**
 * The public contract for channels.
 *
 * Only channels are listed, matching `ListRooms`: a decision thread is reached through its decision, not by
 * browsing, and publishing it as a room would invite a client to page through threads without the decisions
 * they belong to.
 */
import { Authenticated } from "@ea/domain/Identity"
import { pageOf, wireFrom } from "@ea/modules/shared/domain/Wire"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/http-api"
import { Room } from "./Room.ts"

/**
 * A channel as a client reads it.
 *
 * `unreadCount` is published because it is per-reader and computed per request — a client cannot derive it, and
 * recomputing it client-side would need every message. `subjectId` is not: it is null for every channel, and a
 * field that is always null is a question a client should not have to ask.
 */
export const RoomV1 = wireFrom(Room, [
  "id",
  "kind",
  "name",
  "slug",
  "topic",
  "createdBy",
  "createdAt",
  "archivedAt",
  "unreadCount"
])

/** A room id that names nothing in the caller's organization. Says nothing about why. */
export class RoomNotFoundV1 extends Schema.Error<RoomNotFoundV1>(
  "RoomNotFoundV1"
)({ _tag: Schema.tag("RoomNotFoundV1"), room_id: Schema.String }, { httpApiStatus: 404 }) {}

export const RoomGroup = HttpApiGroup.make("rooms")
  .add(
    HttpApiEndpoint.get("list", "/rooms", {
      query: {
        cursor: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.FiniteFromString)
      },
      success: pageOf(RoomV1),
      // A cursor this server did not issue is the caller's error, and the framework's shape is right for it:
      // unlike `UnsupportedDocumentV1`, there is nothing product-specific to say.
      error: HttpApiError.BadRequest
    })
  )
  .middleware(Authenticated)
