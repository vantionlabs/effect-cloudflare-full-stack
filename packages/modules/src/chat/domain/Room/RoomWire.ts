/**
 * The public contract for channels.
 *
 * Only channels are listed, matching `ListRooms`: a decision thread is reached through its decision, not by
 * browsing, and publishing it as a room would invite a client to page through threads without the decisions
 * they belong to.
 */
import { Authenticated } from "@ea/domain/Identity"
import { pageOf, wire, wireFrom } from "@ea/modules/shared/domain/Wire"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from "effect/http-api"
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

/** What a name was refused for, so a client can show the user something better than "invalid". */
export class RoomNameInvalidV1 extends Schema.Error<RoomNameInvalidV1>(
  "RoomNameInvalidV1"
)({ _tag: Schema.tag("RoomNameInvalidV1"), name: Schema.String, reason: Schema.String }, { httpApiStatus: 422 }) {}

/**
 * 409, because the channel exists and the request conflicts with it.
 *
 * Refusing beats inventing `billing-2`: two channels called almost the same thing are two places people post
 * the same question, so the caller is told the handle is taken and picks.
 */
export class RoomSlugTakenV1 extends Schema.Error<RoomSlugTakenV1>(
  "RoomSlugTakenV1"
)({ _tag: Schema.tag("RoomSlugTakenV1"), slug: Schema.String }, { httpApiStatus: 409 }) {}

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
  .add(
    HttpApiEndpoint.post("create", "/rooms", {
      /*
       * `wire` for a REQUEST body too, not only a response. It decodes FROM snake_case, so a client sends
       * `{"name": …}` and a field like `topic_line` would arrive correctly without the handler knowing — the
       * same schema that publishes a shape also accepts it, which is one fewer place for the two to disagree.
       */
      payload: wire({ name: Schema.String, topic: Schema.optional(Schema.String) }),
      /*
       * **201**, because this creates a resource. Annotated per ENDPOINT rather than on `RoomV1`, which is also
       * the 200 body of the collection and of the archive endpoint — a status belongs to an operation, not to a
       * shape.
       */
      success: RoomV1.pipe(HttpApiSchema.status(201)),
      error: [RoomNameInvalidV1, RoomSlugTakenV1]
    })
  )
  .add(
    /*
     * `PUT` on an `archived` sub-resource, not `POST /archive` and not `DELETE /rooms/{id}`.
     *
     * Two reasons. Archiving is reversible, so one idempotent endpoint expresses both directions and a retry is
     * harmless — `POST /archive` twice is ambiguous about whether the second call unarchived it. And a channel
     * is never deleted: deleting one would delete the conversation in it, which for a product whose claim is
     * that decisions can be audited a year later is the wrong default.
     */
    HttpApiEndpoint.put("setArchived", "/rooms/:roomId/archived", {
      params: { roomId: Schema.String },
      payload: wire({ archived: Schema.Boolean }),
      success: RoomV1,
      error: RoomNotFoundV1
    })
  )
  .add(
    /** `PUT`, because marking read is a position a client SETS rather than an event it appends. */
    HttpApiEndpoint.put("markRead", "/rooms/:roomId/read", {
      params: { roomId: Schema.String },
      payload: wire({ messageId: Schema.String }),
      success: wire({ roomId: Schema.String, lastReadMessageId: Schema.String }),
      error: RoomNotFoundV1
    })
  )
  .middleware(Authenticated)
