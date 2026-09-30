/**
 * Issuing, listing and revoking a key. The plaintext exists for one return value and is then unrecoverable.
 */
import { Db } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import {
  ApiKeyId,
  ApiKeySummary,
  DISPLAY_PREFIX_LENGTH,
  hashApiKey,
  IssuedApiKey,
  KEY_PREFIX
} from "@ea/modules/iam/domain/ApiKey"
import { clampPageSize } from "@ea/modules/shared/domain/Page"
import { Effect, Schema } from "effect"

/**
 * 32 bytes from the platform CSPRNG, base64url.
 *
 * `crypto.getRandomValues`, not `Math.random` and not a uuid: a key is a bearer credential, so its only security
 * property is that it cannot be guessed. Base64url so it survives a URL, a header and a shell without escaping.
 */
const generateKey = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const base64 = btoa(String.fromCharCode(...bytes))
  return KEY_PREFIX + base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

export const IssueApiKey = (input: { readonly name: string }) =>
  Effect.gen(function*() {
    const db = yield* Db
    const ids = yield* Ids
    const identity = yield* CurrentUser

    const key = generateKey()
    const keyHash = yield* Effect.promise(() => hashApiKey(key))
    const id = yield* ids.next

    const rows = yield* db.scoped((sql, orgId) =>
      sql<{ created_at: Date }>`
        insert into api_keys (
          id, organization_id, acts_as_user_id, name, key_hash, prefix, created_by_user_id
        ) values (
          ${id}, ${orgId}, ${identity.userId}, ${input.name}, ${keyHash},
          ${key.slice(0, DISPLAY_PREFIX_LENGTH)}, ${identity.userId}
        )
        returning created_at
      `
    )

    return yield* Effect.orDie(
      Schema.decodeUnknownEffect(IssuedApiKey)({
        id,
        name: input.name,
        // The only time this value leaves the process. Nothing logs it, and no other operation returns it.
        key,
        prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
        createdAt: rows[0]!.created_at.toISOString()
      })
    )
  })

export const ListApiKeys = (input: { readonly limit?: number | undefined } = {}) =>
  Effect.gen(function*() {
    const db = yield* Db
    const limit = clampPageSize(input.limit)

    const rows = yield* db.scoped((sql, orgId) =>
      sql<{
        id: string
        name: string
        prefix: string
        created_at: Date
        last_used_at: Date | null
        revoked_at: Date | null
      }>`
        select id, name, prefix, created_at, last_used_at, revoked_at
          from api_keys
         where organization_id = ${orgId}
         order by created_at desc, id desc
         limit ${limit}
      `
    )

    return yield* Effect.orDie(
      Schema.decodeUnknownEffect(Schema.Array(ApiKeySummary))(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          prefix: row.prefix,
          createdAt: row.created_at.toISOString(),
          lastUsedAt: row.last_used_at?.toISOString() ?? null,
          revokedAt: row.revoked_at?.toISOString() ?? null
        }))
      )
    )
  })

/**
 * Revoking is idempotent and never deletes.
 *
 * `where revoked_at is null` so a second call does not move the timestamp — the moment a key stopped working is
 * a fact about the past. Returns whether a key with that id exists at all, which is what separates a 404 from a
 * successful no-op.
 */
export const RevokeApiKey = (input: { readonly apiKeyId: string }) =>
  Effect.gen(function*() {
    const db = yield* Db

    const found = yield* db.scoped((sql, orgId) =>
      sql<{ id: string }>`
        select id from api_keys where organization_id = ${orgId} and id = ${input.apiKeyId}
      `
    )
    if (found[0] === undefined) return null

    yield* db.scoped((sql, orgId) =>
      sql`
        update api_keys set revoked_at = now()
         where organization_id = ${orgId} and id = ${input.apiKeyId} and revoked_at is null
      `
    )
    return ApiKeyId.make(input.apiKeyId)
  })
