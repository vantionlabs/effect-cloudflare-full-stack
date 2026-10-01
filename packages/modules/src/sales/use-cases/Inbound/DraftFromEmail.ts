/**
 * The queue's half: read a received email into a draft quote with the SAME `draftQuoteFor` a person uses.
 *
 * Idempotent by construction. A message already drafted returns without a model call; and if two deliveries race,
 * the partial unique index on `quotes (organization_id, inbound_message_id)` lets one draft in and fails the other's
 * transaction — which is then recognised as "already drafted", not as a failure.
 */
import { Db } from "@ea/database/Database"
import { InboundMessageNotFound } from "@ea/modules/sales/domain/Errors"
import { requestTextOf } from "@ea/modules/sales/domain/Inbound"
import { Effect } from "effect"
import { draftQuoteFor } from "../Quote/DraftQuote.ts"

interface MessageRow {
  status: string
  from_address: string
  from_name: string | null
  subject: string | null
  body_text: string
}

export const DraftFromEmail = (inboundMessageId: string) =>
  Effect.gen(function*() {
    const db = yield* Db
    const [message] = yield* db.scopedForOrg((sql, orgId) =>
      sql<MessageRow>`
        select status, from_address, from_name, subject, body_text from inbound_messages
         where organization_id = ${orgId} and id = ${inboundMessageId}
      `
    )
    if (message === undefined) return yield* new InboundMessageNotFound({ inboundMessageId })
    if (message.status !== "received") return { _tag: "AlreadyHandled" as const }

    return yield* draftQuoteFor({
      request: requestTextOf(message.subject, message.body_text),
      sender: { email: message.from_address, name: message.from_name },
      createdBy: "email",
      inboundMessageId
    }).pipe(
      Effect.map((quote) => ({ _tag: "Drafted" as const, quoteId: quote.id })),
      // The race the unique index settles: the other delivery drafted it. Not a failure.
      Effect.catchTag("SqlError", (error) =>
        String(error.cause).includes("quotes_one_per_inbound_message_idx")
          ? Effect.succeed({ _tag: "AlreadyHandled" as const })
          : Effect.fail(error))
    )
  })

/**
 * Records that a message could not be drafted, for the inbox. Called by the consumer for TERMINAL failures only — a
 * transient one (the model was unavailable) is retried by the queue and must not be marked failed in between.
 */
export const MarkInboundFailed = (inboundMessageId: string, reason: string) =>
  Effect.flatMap(Db, (db) =>
    db.scopedForOrg((sql, orgId) =>
      sql`
        update inbound_messages set status = 'failed', reason = ${reason}
         where organization_id = ${orgId} and id = ${inboundMessageId} and status = 'received'
      `
    ))
