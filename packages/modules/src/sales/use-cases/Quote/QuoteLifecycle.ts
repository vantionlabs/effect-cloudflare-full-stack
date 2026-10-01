/**
 * Listing quotes, and the three things a PERSON does to one: approve, discard, send.
 *
 * Each transition is a compare-and-swap on `status` — `update … where status = <expected> returning` — so two tabs
 * approving produce one approval, and the loser is told the quote is no longer in that state rather than
 * silently succeeding.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import type { OrgId } from "@ea/domain/Identity"
import { QuoteHasNoRecipient, QuoteNotFound, QuoteNotInState } from "@ea/modules/sales/domain/Errors"
import { type QuoteStatus, renderQuoteEmail } from "@ea/modules/sales/domain/Quote"
import { Email } from "@ea/modules/shared/domain/Email"
import { Effect } from "effect"
import type { SqlClient } from "effect/sql"
import { loadQuotes } from "./QuoteRows.ts"

const LIST_LIMIT = 100

export const ListQuotes = (options: { readonly status?: QuoteStatus | undefined } = {}) =>
  Effect.flatMap(Db, (db) =>
    db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        const rows = yield* sql<{ id: string }>`
          select id from quotes
           where organization_id = ${orgId}
             and (${options.status ?? null}::text is null or status = ${options.status ?? null})
           order by created_at desc
           limit ${LIST_LIMIT}
        `
        return yield* loadQuotes(sql, orgId, rows.map((row) => row.id))
      })
    ))

export const GetQuote = (quoteId: string) =>
  Effect.flatMap(
    Db,
    (db) =>
      db.scoped((sql, orgId) =>
        Effect.flatMap(loadQuotes(sql, orgId, [quoteId]), ([quote]) =>
          quote === undefined ? Effect.fail(new QuoteNotFound({ quoteId })) : Effect.succeed(quote))
      )
  )

/** Tells "not found" from "found, but in another state", after a CAS matched nothing. */
const refusal = (sql: SqlClient.SqlClient, orgId: OrgId, quoteId: string, expected: string) =>
  Effect.flatMap(
    sql<{ id: string }>`select id from quotes where organization_id = ${orgId} and id = ${quoteId}`,
    (rows) =>
      Effect.fail(
        rows.length === 0 ? new QuoteNotFound({ quoteId }) : new QuoteNotInState({ quoteId, expected })
      )
  )

export const ApproveQuote = (quoteId: string) =>
  Effect.gen(function*() {
    const db = yield* Db
    const user = yield* CurrentUser
    return yield* db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        const updated = yield* sql<{ id: string }>`
          update quotes set status = 'approved', approved_by = ${user.userId}, approved_at = now()
           where organization_id = ${orgId} and id = ${quoteId} and status = 'draft'
          returning id
        `
        if (updated.length === 0) return yield* refusal(sql, orgId, quoteId, "draft")
        const [quote] = yield* loadQuotes(sql, orgId, [quoteId])
        return quote!
      })
    )
  })

export const DiscardQuote = (quoteId: string) =>
  Effect.flatMap(Db, (db) =>
    db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        // A sent quote is never discarded: the customer has it, and the record must say so.
        const updated = yield* sql<{ id: string }>`
          update quotes set status = 'discarded', discarded_at = now()
           where organization_id = ${orgId} and id = ${quoteId} and status in ('draft', 'approved')
          returning id
        `
        if (updated.length === 0) return yield* refusal(sql, orgId, quoteId, "draft or approved")
        const [quote] = yield* loadQuotes(sql, orgId, [quoteId])
        return quote!
      })
    ))

/**
 * Sends an APPROVED quote to the customer, and marks it sent — atomically with the email.
 *
 * The status update and the send happen inside one transaction, in that order, with the row locked by the update:
 * - the email fails -> the transaction rolls back, the quote is still `approved`, and sending can be retried;
 * - a second tab sends at the same time -> it waits on the row lock, then matches nothing and is refused.
 * So a quote is never marked sent without being sent, and never sent twice. The remaining window — the email
 * accepted and the commit then failing — leaves it `approved` and could send it again; that is the safer of the
 * two errors, because a missing quote is invisible and a duplicate is not.
 */
export const SendQuote = (quoteId: string) =>
  Effect.gen(function*() {
    const db = yield* Db
    const email = yield* Email
    return yield* db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        const updated = yield* sql<{ id: string }>`
          update quotes set status = 'sent', sent_at = now()
           where organization_id = ${orgId} and id = ${quoteId} and status = 'approved'
          returning id
        `
        if (updated.length === 0) return yield* refusal(sql, orgId, quoteId, "approved")
        const [quote] = yield* loadQuotes(sql, orgId, [quoteId])
        if (quote!.customerEmail === null) return yield* new QuoteHasNoRecipient({ quoteId })
        const [org] = yield* sql<{ name: string }>`select name from organization where id = ${orgId}`
        const message = renderQuoteEmail(org?.name ?? "Our company", quote!)
        // A reply to the customer's own email carries its Message-ID, so it threads in their mail client.
        const replyTo = quote!.source === null ? [] : yield* sql<{ message_id: string }>`
          select message_id from inbound_messages
           where organization_id = ${orgId} and id = ${quote!.source.inboundMessageId}
        `
        const threadId = replyTo[0]?.message_id
        yield* email.send({
          to: quote!.customerEmail,
          subject: message.subject,
          text: message.text,
          ...(threadId === undefined || threadId.startsWith("<generated-")
            ? {}
            : { headers: { "In-Reply-To": threadId, References: threadId } })
        })
        return quote!
      })
    )
  })
