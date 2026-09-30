/**
 * A room this organization does not have.
 *
 * The same error whether the room does not exist at all or belongs to another tenant, and that is deliberate:
 * distinguishing them would let a caller enumerate room ids across organizations by watching which id returns
 * which error. Every read is scoped (ADR-0014), so from the caller's side the two cases are identical, and the
 * error says so.
 */
import { Schema } from "effect"

export class RoomNotFound extends Schema.TaggedError<RoomNotFound>()("RoomNotFound", {
  roomId: Schema.String
}) {}
