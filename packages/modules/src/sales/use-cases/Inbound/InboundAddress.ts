/**
 * The organization's receiving address: read it, create or rotate it, and — the one cross-tenant read — find the
 * organization an incoming email's token belongs to.
 *
 * The token is a capability: anyone who knows it can put a request in this organization's inbox. So it is random
 * (≈50 bits), shown only to members, and rotatable — rotating disables the old token at once, which is the remedy
 * for an address that leaked into a spam list.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser, OrgId } from "@ea/domain/Identity"
import { InboundAddressForbidden } from "@ea/modules/sales/domain/Errors"
import { InboundAddress } from "@ea/modules/sales/domain/Inbound"
import { Effect } from "effect"
import { v4 as uuidv4 } from "uuid"

/** Ten base-36 characters from a v4 UUID's random bits: short enough to type, ≈50 bits of guessing. */
const newToken = Effect.sync(() =>
  BigInt(`0x${uuidv4().replaceAll("-", "")}`).toString(36).slice(-10).padStart(10, "0")
)

const addressFor = (token: string, domain: string | null) => domain === null ? null : `${token}@${domain}`

interface AddressRow {
  token: string
  created_at: Date
}

/** The active address, or null when the organization has none yet. `domain` is the deployment's, if configured. */
export const GetInboundAddress = (domain: string | null) =>
  Effect.flatMap(Db, (db) =>
    db.scoped((sql, orgId) =>
      Effect.map(
        sql<AddressRow>`
          select token, created_at from inbound_addresses
           where organization_id = ${orgId} and disabled_at is null
        `,
        (rows) =>
          rows[0] === undefined
            ? null
            : new InboundAddress({
              token: rows[0].token,
              address: addressFor(rows[0].token, domain),
              createdAt: rows[0].created_at.toISOString()
            })
      )
    ))

/** Creates the address, or replaces it: the old token stops working immediately. Owner and admin only. */
export const RotateInboundAddress = (domain: string | null) =>
  Effect.gen(function*() {
    const user = yield* CurrentUser
    if (user.role !== "owner" && user.role !== "admin") return yield* new InboundAddressForbidden({ role: user.role })
    const db = yield* Db
    const token = yield* newToken
    return yield* db.scoped((sql, orgId) =>
      Effect.gen(function*() {
        yield* sql`
          update inbound_addresses set disabled_at = now()
           where organization_id = ${orgId} and disabled_at is null
        `
        const [row] = yield* sql<AddressRow>`
          insert into inbound_addresses (token, organization_id) values (${token}, ${orgId})
          returning token, created_at
        `
        return new InboundAddress({
          token: row!.token,
          address: addressFor(row!.token, domain),
          createdAt: row!.created_at.toISOString()
        })
      })
    )
  })

/**
 * The organization an incoming email's token belongs to, or null for an unknown or disabled token.
 *
 * `unscopedForAuth`: the organization is the ANSWER here, exactly as for an API key — the token is the credential
 * the message presents. One statement, selecting the id only; everything done with the message afterwards re-enters
 * a scoped path with this organization.
 */
export const ResolveInboundToken = (token: string) =>
  Effect.flatMap(Db, (db) =>
    db.unscopedForAuth((sql) =>
      Effect.map(
        sql<{ organization_id: string }>`
          -- tenant: the organization is the answer
          select organization_id from inbound_addresses
           where token = ${token.toLowerCase()} and disabled_at is null
        `,
        (rows) => rows[0] === undefined ? null : OrgId.make(rows[0].organization_id)
      )
    ))
