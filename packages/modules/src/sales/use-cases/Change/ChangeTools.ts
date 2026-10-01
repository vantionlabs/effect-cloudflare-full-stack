/**
 * The tools the model may use when asked to change the price list. They PROPOSE; they never touch `products`.
 *
 * Each call checks what the model passed against the instruction (`checkRequested`), computes the exact before and
 * after from the current product, and stores a pending proposal — or answers the model with the reason it could
 * not. A change that would alter nothing is not proposed.
 *
 * Built per request, closing over the request's connection, tenant, person and the instruction itself — the
 * instruction is what every value is checked against, so the model cannot substitute its own.
 */
import { Db } from "@ea/database/Database"
import { type CurrentOrg, CurrentUser } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { checkRequested, fieldsOf, sameFields } from "@ea/modules/sales/domain/Change"
import { Unit } from "@ea/modules/sales/domain/Product"
import { containsVerbatim } from "@ea/modules/shared/domain/Verbatim"
import { Effect, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import type { SqlClient } from "effect/sql"
import { ListProducts } from "../Product/Products.ts"

const Proposal = Schema.Struct({
  proposed: Schema.Boolean,
  /** Present when proposed. */
  change_id: Schema.optional(Schema.String),
  /** Present when not proposed: why, in words the model can relay or act on. */
  reason: Schema.optional(Schema.String)
})

export const ProposeProductChange = Tool.make("propose_product_change", {
  description: "Propose a change to an EXISTING product in the price list, by SKU. Pass only the fields the " +
    "instruction changes. Values must be copied exactly from the instruction. A person approves before it applies.",
  parameters: Schema.Struct({
    sku: Schema.String,
    name: Schema.optional(Schema.String),
    price_eur: Schema.optional(Schema.String).annotate({
      description: "Exactly as written, e.g. \"199\" or \"42,50\"."
    }),
    vat_percent: Schema.optional(Schema.String).annotate({ description: "0, 9 or 21, as written." }),
    active: Schema.optional(Schema.Boolean).annotate({ description: "false to stop offering it." })
  }),
  success: Proposal
})

export const ProposeNewProduct = Tool.make("propose_new_product", {
  description: "Propose adding a NEW product to the price list. Every value must be copied exactly from the " +
    "instruction. A person approves before it applies.",
  parameters: Schema.Struct({
    sku: Schema.String,
    name: Schema.String,
    unit: Unit,
    price_eur: Schema.String,
    vat_percent: Schema.String
  }),
  success: Proposal
})

export const ChangeToolkit = Toolkit.make(ProposeProductChange, ProposeNewProduct)

export const changeToolkitFor = (instruction: string) =>
  ChangeToolkit.toLayer(
    Effect.gen(function*() {
      // `CurrentOrg` too: the price list is read tenant-scoped (`ListProducts`), and handlers must need nothing.
      const context = yield* Effect.context<Db | SqlClient.SqlClient | CurrentUser | CurrentOrg | Ids>()
      const db = yield* Db
      const ids = yield* Ids
      // Who asked — recorded on every proposal, so an applied change can always be traced to a person.
      const user = yield* CurrentUser

      /*
       * Stores a proposal — or returns the IDENTICAL one already pending.
       *
       * The real model repeats itself, and concurrently: asked once to raise one price, it issued four identical
       * tool calls at the same time, and the page showed four proposals. A check-then-insert let all four through,
       * each having looked before any had written. So the insert is the claim, against a partial unique index on
       * pending proposals (migration 0032), and a conflict reads back the one that won. Different pending changes to
       * one product are still allowed; the stale check at apply time decides between them.
       */
      const store = (kind: "update_product" | "create_product", sku: string, before: unknown, after: unknown) =>
        Effect.gen(function*() {
          const id = yield* ids.next
          const changeId = yield* db.scoped((sql, orgId) =>
            Effect.gen(function*() {
              const inserted = yield* sql<{ id: string }>`
                insert into change_proposals (id, organization_id, status, kind, sku, before, after, instruction, created_by)
                values (
                  ${id}, ${orgId}, 'pending', ${kind}, ${sku},
                  ${before === null ? null : JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb,
                  ${instruction}, ${user.userId}
                )
                on conflict (organization_id, kind, sku, after) where status = 'pending' do nothing
                returning id
              `
              if (inserted[0] !== undefined) return inserted[0].id
              const existing = yield* sql<{ id: string }>`
                select id from change_proposals
                 where organization_id = ${orgId} and status = 'pending' and kind = ${kind} and sku = ${sku}
                   and after = ${JSON.stringify(after)}::jsonb
              `
              return existing[0]!.id
            })
          )
          return { proposed: true, change_id: changeId }
        })

      return {
        propose_product_change: (input) =>
          Effect.gen(function*() {
            const product = (yield* ListProducts({ includeInactive: true })).find(
              (candidate) => candidate.sku.toLowerCase() === input.sku.toLowerCase()
            )
            if (product === undefined) return { proposed: false, reason: `There is no product with SKU ${input.sku}.` }
            const before = fieldsOf(product)
            const checked = checkRequested(before, input, instruction)
            if (checked._tag === "Refused") return { proposed: false, reason: checked.reason }
            if (sameFields(before, checked.after)) {
              return { proposed: false, reason: `${product.sku} already has those values.` }
            }
            return yield* store("update_product", product.sku, before, checked.after)
          }).pipe(Effect.provide(context), Effect.orDie),
        propose_new_product: (input) =>
          Effect.gen(function*() {
            if (!containsVerbatim(input.sku, instruction)) {
              return { proposed: false, reason: `The SKU "${input.sku}" is not in the instruction.` }
            }
            const existing = (yield* ListProducts({ includeInactive: true })).some(
              (candidate) => candidate.sku.toLowerCase() === input.sku.toLowerCase()
            )
            if (existing) {
              return { proposed: false, reason: `${input.sku} already exists; propose a change to it instead.` }
            }
            const start = { sku: input.sku.trim(), name: "", unit: input.unit, unitPrice: 0, vat: 210, active: true }
            const checked = checkRequested(start, input, instruction)
            if (checked._tag === "Refused") {
              return { proposed: false, reason: checked.reason }
            }
            return yield* store("create_product", start.sku, null, checked.after)
          }).pipe(Effect.provide(context), Effect.orDie)
      }
    })
  )
