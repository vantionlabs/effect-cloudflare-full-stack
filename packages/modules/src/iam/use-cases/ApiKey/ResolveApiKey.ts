/**
 * A presented key becomes an `Identity`, or nothing.
 *
 * **The same `Identity` a cookie produces**, which is the whole design: every use case already requires
 * `CurrentUser`, so a second authentication path has to satisfy that same tag rather than introduce a parallel
 * one. Two identity types would mean every use case either handles both or silently works for one caller and not
 * the other.
 *
 * **It does not go through `Db.scoped`, and that is the one place it cannot.** The lookup is *how* the
 * organization is discovered, so there is no tenant to scope by yet — the same exemption
 * `shared/use-cases/Event` has, and for the same reason. Everything after this point is scoped normally, and the
 * key's own row supplies the organization.
 */
import { type Connect, withDatabase } from "@ea/database/Database"
import { Identity, type MemberRole, OrgId, UserId } from "@ea/domain/Identity"
import { apiKeyFrom, hashApiKey } from "@ea/modules/iam/domain/ApiKey"
import { Effect, Result, Schema } from "effect"
import { SqlClient } from "effect/sql"

/**
 * Resolves a key to an identity, refusing revoked keys and members who are no longer members.
 *
 * The membership is joined rather than trusted from the key's row, so **removing somebody from an organization
 * revokes their keys with them** — a key has no authority of its own, which is what `acts_as_user_id` means.
 */
export const ResolveApiKey = (header: string | null | undefined) =>
  Effect.gen(function*() {
    const presented = apiKeyFrom(header)
    if (presented === null) return null

    const keyHash = yield* Effect.promise(() => hashApiKey(presented))
    const sql = yield* SqlClient.SqlClient

    const rows = yield* sql<{
      id: string
      organization_id: string
      acts_as_user_id: string
      email: string | null
      role: string | null
    }>`
      -- tenant: the organization is the answer
      select k.id, k.organization_id, k.acts_as_user_id, u.email, m.role
        from api_keys k
        join member m on m."organizationId" = k.organization_id and m."userId" = k.acts_as_user_id
        left join "user" u on u.id = k.acts_as_user_id
       where k.key_hash = ${keyHash}
         and k.revoked_at is null
    `

    const row = rows[0]
    if (row === undefined || row.role === null) return null

    /*
     * Bound to a local named `orgId`, which is what the tenancy check looks for: it matches an identifier
     * ENDING in `orgId` with no dots, so `${row.organization_id}` would have been invisible to it. Naming the
     * value is the cheap way to stay inside the rule rather than outside it.
     */
    const orgId = row.organization_id

    /*
     * The role is DECODED, exactly as the cookie path now does. better-auth's default role is `member`, which is
     * not in our closed set, so a key acting as a member with that role is refused rather than granted something
     * nobody defined. See `.scratch/rest-api/issues/05`.
     */
    const decoded = Schema.decodeUnknownResult(Schema.Literals(["owner", "reviewer", "viewer"]))(row.role)
    if (!Result.isSuccess(decoded)) return null

    /*
     * Recorded on use, and deliberately NOT awaited for correctness: the answer does not depend on it, and a
     * failed bookkeeping write must not fail an authenticated request. It is in the same statement stream, so it
     * still happens before the response — a Worker has no reliable after-response hook for a database write.
     */
    /*
     * Scoped by the organization the row itself named, not exempted. The key has just been resolved, so the
     * tenant is known — and a bookkeeping write that skipped the predicate would be the one statement in this
     * file the tenancy rule could not check.
     */
    yield* Effect.ignore(sql`
      update api_keys set last_used_at = now()
       where id = ${row.id} and organization_id = ${orgId}
    `)

    return new Identity({
      userId: UserId.make(row.acts_as_user_id),
      orgId: OrgId.make(orgId),
      email: row.email ?? "",
      role: decoded.success as MemberRole
    })
  })

/** As above, with a connection of its own. What the middleware calls. */
export const resolveApiKeyIdentity = (
  header: string | null | undefined
): Effect.Effect<Identity | null, never, Connect> =>
  // `orElseSucceed`: an unreachable database must produce "no session" and therefore a 401, never a 500 that
  // tells a caller the difference between a bad key and a broken database.
  Effect.orElseSucceed(withDatabase(ResolveApiKey(header)), () => null)
