/**
 * An email reached the organization's address: record it, and queue it to be read into a draft quote.
 *
 * Everything that reaches a KNOWN address leaves a row — refused or not — because a customer's request that vanishes
 * is the worst outcome this feature can have. The order of checks is the order of cost: a duplicate is a no-op, an
 * automated message is recorded and refused, the hourly limit is counted, and only then is a model call queued.
 *
 * Requires `CurrentOrg`, resolved from the token by the caller (`ResolveInboundToken`): this never chooses a tenant.
 */
import { Db } from "@ea/database/Database"
import { Ids } from "@ea/domain/Ids"
import { isAutomated, MAX_INBOUND_BODY_CHARS, MAX_INBOUND_PER_HOUR } from "@ea/modules/sales/domain/Inbound"
import { draftFromEmailEventKey } from "@ea/modules/shared/domain/Event"
import { EmitEvent } from "@ea/modules/shared/use-cases/Event"
import { Effect } from "effect"

export interface ReceivedEmail {
  readonly messageId: string | null
  readonly fromAddress: string
  readonly fromName: string | null
  readonly subject: string | null
  readonly text: string
  readonly autoSubmitted: string | null
  readonly precedence: string | null
}

export type ReceiveOutcome =
  | { readonly _tag: "Queued"; readonly inboundMessageId: string }
  | { readonly _tag: "Duplicate" }
  | { readonly _tag: "Rejected"; readonly inboundMessageId: string; readonly reason: string }

export const ReceiveEmail = (email: ReceivedEmail) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids
    const id = yield* ids.next
    // A message with no Message-ID cannot be recognised when it arrives again, so it gets one of its own.
    const messageId = email.messageId?.trim() || `<generated-${id}@effect-ai>`
    const truncated = email.text.length > MAX_INBOUND_BODY_CHARS
    const body = truncated ? email.text.slice(0, MAX_INBOUND_BODY_CHARS) : email.text

    const refusal = isAutomated(email)
      ? "Automatisch bericht (afwezigheidsmelding of mailinglijst) — niet gelezen."
      : null

    const recorded = yield* db.scopedForOrg((sql, orgId) =>
      Effect.gen(function*() {
        const [{ recent } = { recent: 0 }] = yield* sql<{ recent: number }>`
          select count(*)::integer as recent from inbound_messages
           where organization_id = ${orgId} and received_at > now() - interval '1 hour'
             and status <> 'rejected'
        `
        const reason = refusal ??
          (recent >= MAX_INBOUND_PER_HOUR
            ? `Meer dan ${MAX_INBOUND_PER_HOUR} berichten in een uur — dit bericht is niet gelezen.`
            : null)
        const inserted = yield* sql<{ id: string }>`
          insert into inbound_messages (
            id, organization_id, message_id, from_address, from_name, subject, body_text, truncated, status, reason
          ) values (
            ${id}, ${orgId}, ${messageId}, ${email.fromAddress.trim().toLowerCase()}, ${email.fromName}, ${email.subject},
            ${body}, ${truncated}, ${reason === null ? "received" : "rejected"}, ${reason}
          )
          on conflict (organization_id, message_id) do nothing
          returning id
        `
        return { inserted: inserted.length > 0, reason }
      })
    )

    if (!recorded.inserted) return { _tag: "Duplicate" } satisfies ReceiveOutcome as ReceiveOutcome
    if (recorded.reason !== null) {
      return {
        _tag: "Rejected",
        inboundMessageId: id,
        reason: recorded.reason
      } satisfies ReceiveOutcome as ReceiveOutcome
    }
    // Row first, then the event: the same order `EmitEvent` itself keeps, so a lost send is swept, never lost work.
    yield* EmitEvent({
      type: "quote.draft-from-email",
      idempotencyKey: draftFromEmailEventKey(id),
      payload: { inboundMessageId: id }
    })
    return { _tag: "Queued", inboundMessageId: id } satisfies ReceiveOutcome as ReceiveOutcome
  })
