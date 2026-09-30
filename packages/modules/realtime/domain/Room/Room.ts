/**
 * A room: a place messages live, with a row of its own.
 *
 * **This is the trigger firing.** `Message.ts` said a `rooms` table would arrive when there was "a thread that
 * is not attached to anything (a named channel)", and named channels are exactly that. Until now a room was
 * only a *derived name* — organization plus subject — which was enough while every thread hung off a decision.
 * A channel has no subject, so it needs an identity somebody chose.
 *
 * **Two kinds, one table.** A `channel` is created by a person and has a name; a `decision` thread is implicit
 * and keyed by the decision it discusses. They share a table because they are the same thing to everything
 * downstream — messages, reactions, read state all key off a room id — and a second table would mean every one
 * of those needing two foreign keys and a branch. The differences are two nullable columns and two partial
 * unique indexes, which is cheaper than the duplication.
 *
 * Note what a room row still does NOT do: it is not the fan-out target. Broadcasting still goes to the
 * organization's socket room with the room id inside the frame (ADR-0018 and `MessagePosted`), so there is one
 * socket per person and no subscribe protocol. A row per room and a socket per room are separate decisions.
 */
import { UserId } from "@ea/modules/shared/domain/Identity"
import { Schema } from "effect"

export const RoomId = Schema.String.pipe(Schema.brand("RoomId"))
export type RoomId = typeof RoomId.Type

/**
 * What kind of room this is. Closed, with a matching CHECK on the column.
 *
 * `channel` — named, created by a person, lives until archived.
 * `decision` — implicit, one per decision, created on the first message.
 */
export const RoomKind = Schema.Literals(["channel", "decision"])
export type RoomKind = typeof RoomKind.Type

export const MAX_ROOM_NAME_LENGTH = 80
export const MAX_ROOM_TOPIC_LENGTH = 300
export const MAX_SLUG_LENGTH = 48

/**
 * A URL-safe handle derived from the name, and the thing uniqueness is checked on.
 *
 * Derived rather than asked for, because two fields that must agree are two fields that will not. It is also
 * why the collision error carries the slug: "Billing" and "billing" are the same channel, and telling somebody
 * their *name* is taken when they typed different characters reads like a bug.
 *
 * Deliberately lossy for anything that is not ASCII alphanumeric — including emoji and CJK, which collapse to
 * nothing and are refused with `RoomNameInvalid`. A transliterating slugifier would be kinder and is a
 * dependency plus a pile of locale decisions; the name itself is preserved for display, so what is lost is
 * only the handle.
 */
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    // A trailing hyphen can appear after the slice, which would make two names collide on a cosmetic detail.
    .replace(/-+$/g, "")

export class Room extends Schema.Class<Room>("Room")({
  id: RoomId,
  kind: RoomKind,
  /** The display name. For a decision thread, the document's filename is not known here — see `name` below. */
  name: Schema.String,
  /** Null for a decision thread, which has no handle because nobody addresses it by one. */
  slug: Schema.NullOr(Schema.String),
  topic: Schema.NullOr(Schema.String),
  /** The decision this thread hangs off, or null for a channel. */
  subjectId: Schema.NullOr(Schema.String),
  createdBy: UserId,
  createdAt: Schema.String,
  /**
   * Archived rather than deleted, and reversible.
   *
   * Deleting a channel would delete the conversation in it, which for a product whose claim is that decisions
   * can be audited a year later is the wrong default. An archived room is hidden from the list and refuses new
   * messages; everything said in it remains readable.
   */
  archivedAt: Schema.NullOr(Schema.String),
  /**
   * How many messages this reader has not seen, counted per request.
   *
   * A per-READER field on a shared entity, like `mine` on a reaction — which is why it is counted rather than
   * stored: a stored counter would need incrementing for every member on every post, and would drift the first
   * time one of those writes was lost. Own messages are excluded: you have read what you wrote.
   *
   * Zero for a room nobody has posted in, and zero from `Room.create` and `Room.archive`, which return the room
   * they just changed rather than running the count.
   */
  unreadCount: Schema.Int
}) {}

/**
 * How a caller names a room, without needing to have looked it up.
 *
 * A tagged union rather than two methods, because the alternative costs a round trip: the console opens a
 * decision and wants its thread, and a decision's room may not exist yet — it is created on the first message.
 * `ForDecision` lets `Message.list` and `Message.post` resolve or create it in the same call that uses it.
 */
export class RoomById extends Schema.TaggedClass<RoomById>("RoomById")("RoomById", {
  roomId: RoomId
}) {}

export class RoomForDecision extends Schema.TaggedClass<RoomForDecision>("RoomForDecision")("RoomForDecision", {
  decisionId: Schema.String
}) {}

export const RoomRef = Schema.Union([RoomById, RoomForDecision])
export type RoomRef = typeof RoomRef.Type
