/**
 * The message RPC contract.
 *
 * Reading and posting go over RPC, not over the socket. That split is ADR-0020's rule rather than a
 * preference: a message must be in Postgres before anyone sees it, so it needs the database connection, the
 * error channel and a response the caller can act on — all of which the RPC path has and a fire-and-forget
 * frame does not. The socket only carries the notification afterwards.
 */
import { AuthenticatedRpc } from "@ea/modules/shared/domain/Identity"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { MAX_BODY_LENGTH, Message, MessageId, SubjectKind } from "./Message.ts"

/**
 * A body that is actually a message.
 *
 * Trimmed and bounded in the CONTRACT, so an empty string is refused before it reaches a use case and a
 * 100 KB paste is refused before it reaches a broadcast. The same bound is a CHECK on the column: the schema
 * is a better error message, the constraint is the guarantee.
 */
const MessageBody = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_BODY_LENGTH))

export const MessageRpcs = RpcGroup.make(
  Rpc.make("Message.list", {
    payload: {
      subjectKind: SubjectKind,
      subjectId: Schema.String,
      /**
       * Keyset pagination, and it is the same query a reconnecting client uses to catch up.
       *
       * "Everything after this id" rather than an offset, because ids are time-ordered (UUIDv7) so `id >`
       * is chronological — and because an offset shifts under inserts, which is precisely what a live thread
       * does. One query shape serves the first page, the next page and the catch-up.
       */
      after: Schema.optional(MessageId),
      limit: Schema.optional(Schema.Int)
    },
    success: Schema.Array(Message)
  }),
  Rpc.make("Message.post", {
    payload: {
      subjectKind: SubjectKind,
      subjectId: Schema.String,
      body: MessageBody
    },
    /**
     * Returns the stored message, not an acknowledgement.
     *
     * The caller needs the id and the server's timestamp to render it, and returning them means the poster's
     * copy is the same row everybody else will receive over the socket rather than a local reconstruction
     * that might differ.
     */
    success: Message
  })
).middleware(AuthenticatedRpc)
