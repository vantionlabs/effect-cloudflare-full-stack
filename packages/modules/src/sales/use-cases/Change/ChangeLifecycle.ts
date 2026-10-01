/**
 * Proposing changes by asking, listing them, and the two things a PERSON does: apply or reject.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { type ProductFields, ProposalRun, sameFields } from "@ea/modules/sales/domain/Change"
import { ChangeIsStale, ChangeNotFound, ChangeNotPending } from "@ea/modules/sales/domain/Errors"
import { Effect } from "effect"
import { LanguageModel, Prompt } from "effect/ai"
import { loadChanges, toChange } from "./ChangeRows.ts"
import { ChangeToolkit } from "./ChangeTools.ts"

/** An instruction, not a document. */
export const MAX_INSTRUCTION_LENGTH = 1000
const MAX_STEPS = 4

const SYSTEM = `You turn a person's instruction about their price list into PROPOSED changes, using the tools.

- Use propose_product_change for an existing product (by SKU), propose_new_product for a new one.
- Copy every value EXACTLY from the instruction: prices as written ("199", "42,50"), VAT as a percentage (0, 9, 21),
  names and SKUs as written. Never invent or compute a value. If the instruction does not give a value, leave it out.
- A tool may refuse; do not retry the same call. Stop when every requested change has been proposed or refused.
- Nothing is changed until a person approves each proposal.`

/**
 * Runs the proposal loop. Requires `LanguageModel` with tool calling, and the toolkit built for THIS instruction
 * (`changeToolkitFor`). Returns what was proposed and what was refused; the model's prose is deliberately dropped.
 */
export const ProposeChanges = (instruction: string) =>
  Effect.gen(function*() {
    let prompt = Prompt.make([
      { role: "system", content: SYSTEM },
      { role: "user", content: [{ type: "text", text: instruction }] }
    ])
    const proposed: Array<string> = []
    const refusals: Array<string> = []
    for (let step = 1; step <= MAX_STEPS; step++) {
      const response = yield* LanguageModel.generateText({ prompt, toolkit: ChangeToolkit })
      prompt = Prompt.concat(prompt, Prompt.fromResponseParts(response.content))
      for (const part of response.toolResults) {
        const result = part.result as {
          readonly proposed: boolean
          readonly change_id?: string
          readonly reason?: string
        }
        if (result.proposed && result.change_id !== undefined) proposed.push(result.change_id)
        else if (result.reason !== undefined) refusals.push(result.reason)
      }
      if (!response.content.some((part) => part.type === "tool-call")) break
    }
    const db = yield* Db
    const proposals = yield* db.scoped((sql, orgId) => loadChanges(sql, orgId, proposed))
    // Refusals are the tools' own reasons, not the model's prose, which is deliberately dropped.
    return new ProposalRun({ proposals, refusals: [...new Set(refusals)] })
  })

/** Pending proposals first, then the most recent decided ones. */
export const ListChanges = Effect.flatMap(Db, (db) =>
  db.scoped((sql, orgId) =>
    Effect.map(
      sql<Parameters<typeof toChange>[0]>`
        select id, status, kind, sku, before, after, instruction, created_at from change_proposals
         where organization_id = ${orgId}
         order by (status = 'pending') desc, created_at desc
         limit 50
      `,
      (rows) => rows.map(toChange)
    )
  ))

/**
 * Applies a pending proposal — in one transaction: claim it, check the product still equals `before`, write it.
 * A stale proposal fails the whole transaction, so the claim is rolled back and the proposal stays pending for a
 * person to reject.
 */
export const ApplyChange = (changeId: string) =>
  Effect.gen(function*() {
    const db = yield* Db
    const user = yield* CurrentUser
    return yield* db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        const claimed = yield* sql<{ kind: string; sku: string; before: ProductFields | null; after: ProductFields }>`
          update change_proposals set status = 'applied', decided_by = ${user.userId}, decided_at = now()
           where organization_id = ${orgId} and id = ${changeId} and status = 'pending'
          returning kind, sku, before, after
        `
        const change = claimed[0]
        if (change === undefined) {
          const exists = yield* sql<{ id: string }>`
            select id from change_proposals where organization_id = ${orgId} and id = ${changeId}
          `
          return yield* (exists.length === 0 ? new ChangeNotFound({ changeId }) : new ChangeNotPending({ changeId }))
        }
        const current = yield* sql<
          {
            sku: string
            name: string
            unit: ProductFields["unit"]
            unit_price_cents: number
            vat_per_mille: number
            active: boolean
          }
        >`
          select sku, name, unit, unit_price_cents, vat_per_mille, active from products
           where organization_id = ${orgId} and sku = ${change.sku}
           for update
        `
        const now = current[0] === undefined ? null : {
          sku: current[0].sku,
          name: current[0].name,
          unit: current[0].unit,
          unitPrice: current[0].unit_price_cents,
          vat: current[0].vat_per_mille,
          active: current[0].active
        }
        // What the person read must still be the truth: same product, or still no product for a creation.
        const fresh = change.before === null ? now === null : now !== null && sameFields(now, change.before)
        if (!fresh) return yield* new ChangeIsStale({ changeId, sku: change.sku })

        const a = change.after
        if (change.kind === "create_product") {
          yield* sql`
            insert into products (id, organization_id, sku, name, unit, unit_price_cents, vat_per_mille, active)
            values (${changeId}, ${orgId}, ${a.sku}, ${a.name}, ${a.unit}, ${a.unitPrice}, ${a.vat}, ${a.active})
          `
        } else {
          yield* sql`
            update products set name = ${a.name}, unit_price_cents = ${a.unitPrice}, vat_per_mille = ${a.vat},
                   active = ${a.active}, updated_at = now()
             where organization_id = ${orgId} and sku = ${change.sku}
          `
        }
        const [applied] = yield* loadChanges(sql, orgId, [changeId])
        return applied!
      })
    )
  })

export const RejectChange = (changeId: string) =>
  Effect.gen(function*() {
    const db = yield* Db
    const user = yield* CurrentUser
    return yield* db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        const updated = yield* sql<{ id: string }>`
          update change_proposals set status = 'rejected', decided_by = ${user.userId}, decided_at = now()
           where organization_id = ${orgId} and id = ${changeId} and status = 'pending'
          returning id
        `
        if (updated.length === 0) {
          const exists = yield* sql<{ id: string }>`
            select id from change_proposals where organization_id = ${orgId} and id = ${changeId}
          `
          return yield* (exists.length === 0 ? new ChangeNotFound({ changeId }) : new ChangeNotPending({ changeId }))
        }
        const [rejected] = yield* loadChanges(sql, orgId, [changeId])
        return rejected!
      })
    )
  })
