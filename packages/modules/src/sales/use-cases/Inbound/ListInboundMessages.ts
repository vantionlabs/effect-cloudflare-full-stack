/**
 * The inbox: the organization's most recent inbound messages, refused ones included, newest first.
 *
 * A message whose drafting event went to the dead-letter queue — the model kept failing past every retry — is shown
 * as failed, read from the event's own status. Otherwise it would sit at "received" forever, which reads as "still
 * working" when nothing is.
 */
import { Db } from "@ea/database/Database"
import { InboundMessage, type InboundStatus } from "@ea/modules/sales/domain/Inbound"
import { Effect } from "effect"

interface Row {
  id: string
  from_address: string
  from_name: string | null
  subject: string | null
  received_at: Date
  status: InboundStatus
  quote_id: string | null
  reason: string | null
  truncated: boolean
}

export const ListInboundMessages = Effect.flatMap(Db, (db) =>
  db.scoped((sql, orgId) =>
    Effect.map(
      sql<Row>`
        select m.id, m.from_address, m.from_name, m.subject, m.received_at, m.quote_id, m.truncated,
               case when m.status = 'received' and e.status = 'dead' then 'failed' else m.status end as status,
               case when m.status = 'received' and e.status = 'dead'
                    then 'Kon na herhaalde pogingen niet gelezen worden.' else m.reason end as reason
          from inbound_messages m
          left join events e
            on e.organization_id = ${orgId} and e.idempotency_key = 'quote-email:' || m.id
         where m.organization_id = ${orgId}
         order by m.received_at desc
         limit 50
      `,
      (rows) =>
        rows.map((row) =>
          new InboundMessage({
            id: row.id,
            fromAddress: row.from_address,
            fromName: row.from_name,
            subject: row.subject,
            receivedAt: row.received_at.toISOString(),
            status: row.status,
            quoteId: row.quote_id,
            reason: row.reason,
            truncated: row.truncated
          })
        )
    )
  ))
