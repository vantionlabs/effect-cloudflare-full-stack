/**
 * A user and an organization become an `Identity`, if the membership is real.
 *
 * **This is the check that makes an API key's claimed organization safe.** better-auth's key plugin stores the
 * organization in caller-supplied `metadata`, so a key *asserts* a tenant rather than proving one; what proves it
 * is this row. A key naming an organization its user does not belong to resolves to nothing, and removing
 * somebody from an organization disables their keys without anything touching the key.
 *
 * It reads better-auth's `member` table directly, which is the one place this repo does. The alternative was
 * better-auth's own API, and every membership route it offers derives from a SESSION — which an API key does not
 * have. A single indexed read of a table we never write is the smaller compromise.
 */
import { Identity, type MemberRole, OrgId, UserId } from "@ea/domain/Identity"
import { Effect, Result, Schema } from "effect"
import { SqlClient } from "effect/sql"

const MemberRoleSchema = Schema.Literals(["owner", "reviewer", "viewer"])

export const IdentityForMember = (input: {
  readonly userId: string
  readonly organizationId: string
}) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient

    /*
     * `member` and `user` are better-auth's, so neither carries `organization_id` and neither is in the tenancy
     * check's table list. The tenant here is what the query VERIFIES, not what it filters by.
     */
    const rows = yield* sql<{ role: string; email: string | null }>`
      select m.role, u.email
        from member m
        left join "user" u on u.id = m."userId"
       where m."organizationId" = ${input.organizationId} and m."userId" = ${input.userId}
    `

    const row = rows[0]
    if (row === undefined) return null

    /*
     * The role is DECODED. better-auth's default role is `member`, which is not in our closed set, so a
     * membership created by its own invitation flow resolves to nothing rather than to an authorisation nobody
     * defined. Same decision as the cookie path — see `.scratch/rest-api/issues/05`.
     */
    const decoded = Schema.decodeUnknownResult(MemberRoleSchema)(row.role)
    if (!Result.isSuccess(decoded)) return null

    return new Identity({
      userId: UserId.make(input.userId),
      orgId: OrgId.make(input.organizationId),
      email: row.email ?? "",
      role: decoded.success as MemberRole
    })
  })
