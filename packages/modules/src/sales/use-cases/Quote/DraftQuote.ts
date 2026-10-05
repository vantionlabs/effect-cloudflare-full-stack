/**
 * Drafts a quote from a customer's request: one model call to READ the request, then everything else in code.
 *
 * The model is given the request and the active price list (SKU, name, unit — never prices) and returns a
 * `QuoteReading`: verbatim pointers into the request and a SKU per item. `priceQuote` checks every pointer and
 * computes every amount; what it cannot do becomes a flag. The draft is stored for a person to approve, together
 * with the token cost of reading it, in one transaction.
 */
import { Db, textArray } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { priceQuote, QuoteReading } from "@ea/modules/sales/domain/Quote"
import { modelUsageEntries, modelUsageOf } from "@ea/modules/shared/domain/Usage"
import { writeUsage } from "@ea/modules/shared/use-cases/Usage"
import { Effect } from "effect"
import { LanguageModel } from "effect/ai"
import { ListProducts } from "../Product/Products.ts"
import { loadQuotes } from "./QuoteRows.ts"

/** A request is a customer's message, not a document; this keeps one paste from becoming a very long prompt. */
const MAX_REQUEST_LENGTH = 8_000

const instructions = (catalogue: string) =>
  `You read a customer's request for a quote and point at what they ask for.

For every item the customer asks for:
- request_text: copy EXACTLY the words of the request that ask for it.
- quantity_text: copy EXACTLY how the request writes the quantity (for example "3" or "2,5").
- sku: the SKU from the price list below that fits, or null when nothing fits. Never invent a SKU.

Also copy the customer's name and email address exactly as the request writes them, or null when it does not.

Do not state prices, totals or VAT — they are computed from the price list, not by you.

PRICE LIST (SKU | product | unit):
${catalogue}`

/** What a draft is read from, and who or what asked for it. */
export interface DraftInput {
  readonly request: string
  /** The customer, from the mail envelope, when the request arrived by email. Trusted as the reply address. */
  readonly sender?: { readonly email: string; readonly name: string | null } | undefined
  /** Who the draft is recorded as created by: a user id, or `email` for one read from the inbox. */
  readonly createdBy: string
  /** The inbound message this draft answers; at most one draft per message (a partial unique index). */
  readonly inboundMessageId?: string | undefined
}

/**
 * The drafting itself, for any caller with a tenant: a person through the console, or the queue reading an email.
 * Requires `CurrentOrg`, not `CurrentUser` — the queue has no user, and inventing one would put a fabricated identity
 * in `created_by`.
 */
export const draftQuoteFor = (input: DraftInput) =>
  Effect.gen(function*() {
    const request = input.request.slice(0, MAX_REQUEST_LENGTH)
    const catalogue = yield* ListProducts()
    const response = yield* LanguageModel.generateObject({
      prompt: `${
        instructions(catalogue.map((p) => `${p.sku} | ${p.name} | ${p.unit}`).join("\n"))
      }\n\nREQUEST:\n${request}`,
      schema: QuoteReading,
      objectName: "QuoteReading"
    })
    const priced = priceQuote(response.value, request, catalogue, input.sender)
    const usage = modelUsageOf(response)
    const db = yield* Db
    const ids = yield* Ids
    const quoteId = yield* ids.next
    return yield* db.scopedForOrg((sql, orgId) =>
      Effect.gen(function*() {
        yield* sql`
          insert into quotes (
            id, organization_id, status, customer_name, customer_email, request,
            subtotal_cents, vat_total_cents, total_cents, flags, model, created_by,
            request_source, inbound_message_id
          ) values (
            ${quoteId}, ${orgId}, 'draft', ${priced.customerName}, ${priced.customerEmail}, ${request},
            ${priced.subtotal}, ${priced.vatTotal}, ${priced.total}, ${textArray(sql, priced.flags)},
            ${usage?.model ?? null}, ${input.createdBy},
            ${input.inboundMessageId === undefined ? "manual" : "email"}, ${input.inboundMessageId ?? null}
          )
        `
        for (const [ordinal, line] of priced.lines.entries()) {
          yield* sql`
            insert into quote_lines (
              quote_id, organization_id, ordinal, product_id, sku, description, request_text,
              quantity_milli, unit, unit_price_cents, vat_per_mille, line_total_cents
            ) values (
              ${quoteId}, ${orgId}, ${ordinal}, ${line.productId}, ${line.sku}, ${line.description},
              ${line.requestText}, ${line.quantity}, ${line.unit}, ${line.unitPrice}, ${line.vat}, ${line.lineTotal}
            )
          `
        }
        // The message is marked drafted in the SAME transaction as the draft: one cannot exist without the other.
        if (input.inboundMessageId !== undefined) {
          yield* sql`
            update inbound_messages set status = 'drafted', quote_id = ${quoteId}, reason = null
             where organization_id = ${orgId} and id = ${input.inboundMessageId}
          `
        }
        // The cost of reading the request commits with the draft it produced.
        yield* writeUsage(sql, orgId, modelUsageEntries(usage))
        const [quote] = yield* loadQuotes(sql, orgId, [quoteId])
        return quote!
      })
    )
  })

/** A person drafting from a request they pasted in. */
export const DraftQuote = (input: { readonly request: string }) =>
  Effect.flatMap(CurrentUser, (user) => draftQuoteFor({ request: input.request, createdBy: user.userId }))
