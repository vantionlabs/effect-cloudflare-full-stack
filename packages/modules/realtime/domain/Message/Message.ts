/**
 * A message in a thread, and what a thread is attached to.
 *
 * **There is no `rooms` table, and that is a decision rather than an omission.** A room is a *name derived*
 * from an organization and a subject (`RoomName.ts`), so persisting one would store something already implied
 * by the message rows — and it would sit oddly beside ADR-0018, which says a room holds nothing. The trigger
 * for introducing one is concrete: unread counts per member, an explicit member list, or a thread that is not
 * attached to anything (a named channel). Each of those needs a row with its own identity; a comment thread on
 * a decision does not.
 */
import { UserId } from "@ea/modules/shared/domain/Identity"
import { Schema } from "effect"

export const MessageId = Schema.String.pipe(Schema.brand("MessageId"))
export type MessageId = typeof MessageId.Type

/**
 * What a thread hangs off.
 *
 * A closed set, because an unrecognised subject must not be storable: the column has a matching CHECK, and a
 * typo would otherwise produce rows nothing ever reads. `organization` is the tenant-wide channel;
 * `decision` is a thread on one queue item, which is the case the product actually needs — the argument about
 * why something was approved belongs next to the decision rather than in Slack.
 */
export const SubjectKind = Schema.Literals(["organization", "decision"])
export type SubjectKind = typeof SubjectKind.Type

export class MessageSubject extends Schema.Class<MessageSubject>("MessageSubject")({
  kind: SubjectKind,
  /**
   * The decision's id, or the organization's own id for the tenant-wide channel.
   *
   * A plain `string` rather than `DecisionId`: importing that brand would make `realtime` depend on the
   * `decision` slice, and slices compose through `shared`. `Terminal.ts` names other slices' error tags as
   * strings for the same reason. What is lost is a compile-time check that the id is a decision's; what
   * replaces it is that a wrong id can only address a thread inside the caller's own organization.
   */
  id: Schema.String
}) {}

export const MAX_BODY_LENGTH = 4000

export class Message extends Schema.Class<Message>("Message")({
  id: MessageId,
  subject: MessageSubject,
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
  body: Schema.String,
  createdAt: Schema.String
}) {}
