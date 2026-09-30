/**
 * A message in a room.
 *
 * **It used to carry a subject instead of a room id**, because a room was only a derived name and a thread was
 * always attached to a decision. Named channels are the trigger this file predicted — "a thread that is not
 * attached to anything" — so a room now has a row and a message points at it. Migration `0018_messages_rooms`
 * moved the existing rows and dropped the subject columns rather than keeping both, because two ways to
 * identify a thread means every query choosing which to trust.
 */
import { UserId } from "@ea/modules/shared/domain/Identity"
import { Schema } from "effect"
import { RoomId } from "../Room/Room.ts"

export const MessageId = Schema.String.pipe(Schema.brand("MessageId"))
export type MessageId = typeof MessageId.Type

export const MAX_BODY_LENGTH = 4000
export const MAX_EMOJI_LENGTH = 32

/** One emoji on one message: how many people used it, and whether you are one of them. */
export class MessageReaction extends Schema.Class<MessageReaction>("MessageReaction")({
  emoji: Schema.String,
  count: Schema.Int,
  mine: Schema.Boolean
}) {}

export class Message extends Schema.Class<Message>("Message")({
  id: MessageId,
  roomId: RoomId,
  authorUserId: UserId,
  /**
   * The author's email, joined from better-auth's `user` table at read time rather than copied into the row.
   *
   * Copied would be faster and wrong: an address changes, and a thread that still shows the old one is a
   * record of something nobody said. Our tables carry no foreign key into better-auth's (see
   * `TenancyTable.ts`), so this is a read-only join — and it is nullable because a deleted user leaves
   * messages behind, which is the correct outcome for an audit trail.
   */
  authorEmail: Schema.NullOr(Schema.String),
  /**
   * The text, or the redaction that replaced it.
   *
   * A deleted message keeps a row and loses its content — see `MessageTable.ts` for why that is the choice and
   * what it costs. `deletedAt` is what a client should branch on; the stored body is a sentinel, not something
   * to render as if it were written.
   */
  body: Schema.String,
  createdAt: Schema.String,
  /** When the author last changed it, or null. Shown, because an edited record and an original are not the same. */
  editedAt: Schema.NullOr(Schema.String),
  deletedAt: Schema.NullOr(Schema.String),
  /**
   * Reactions, aggregated per emoji rather than listed per person.
   *
   * A count and a `mine` flag is everything a client renders, and it keeps the payload flat: listing reactors
   * would make a busy message's row grow with its popularity, for information nobody shows until they hover.
   * Who reacted is a query that can be added when something needs it.
   */
  reactions: Schema.Array(MessageReaction)
}) {}
