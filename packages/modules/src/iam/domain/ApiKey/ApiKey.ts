/**
 * What an API key is, and how one is turned into a lookup.
 *
 * The hashing lives here, in the domain, rather than beside the table — because it is the *definition* of how a
 * presented key maps to a stored row, and both the creation path and the resolution path must agree about it
 * exactly. Two implementations that agree today is the failure this avoids.
 */
import { Schema } from "effect"

export const ApiKeyId = Schema.String.pipe(Schema.brand("ApiKeyId"))
export type ApiKeyId = typeof ApiKeyId.Type

/**
 * `ea_` and then 32 random bytes as base64url.
 *
 * The prefix is for humans and for secret scanners: a string that announces what it is can be recognised in a
 * log, a commit or a pasted screenshot, which is worth more than the obscurity of hiding it. 32 bytes is 256
 * bits — there is nothing to brute force, which is also why a plain hash is the right storage (see
 * `ApiKeyTable.ts`).
 */
export const KEY_PREFIX = "ea_"

/** How many characters of the plaintext are stored so a list can tell two keys apart. */
export const DISPLAY_PREFIX_LENGTH = 8

/** A key as its owner sees it once: the plaintext, and the row that will outlive it. */
export class IssuedApiKey extends Schema.Class<IssuedApiKey>("IssuedApiKey")({
  id: ApiKeyId,
  name: Schema.String,
  /** **Shown once.** Never stored, never logged, and not returned by any other operation. */
  key: Schema.String,
  prefix: Schema.String,
  createdAt: Schema.String
}) {}

/** A key as it appears in a list: everything except the secret. */
export class ApiKeySummary extends Schema.Class<ApiKeySummary>("ApiKeySummary")({
  id: ApiKeyId,
  name: Schema.String,
  prefix: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
  revokedAt: Schema.NullOr(Schema.String)
}) {}

/**
 * SHA-256 of the presented key, as lowercase hex.
 *
 * `crypto.subtle` because it is the one hash available in every runtime this code touches — `workerd`, Node and
 * the test harness — without a dependency. It is async, which is why every caller of this is an Effect.
 */
export const hashApiKey = async (key: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Reads a key out of an `Authorization: Bearer` or `X-API-Key` header value, or returns null.
 *
 * Both are accepted because both are what clients reach for, and neither is more correct. The prefix check is
 * what makes a **session cookie or a JWT presented here fail fast** rather than being hashed and looked up —
 * a miss would be indistinguishable from a wrong key, so the cheap rejection is also the clearer one.
 */
export const apiKeyFrom = (header: string | null | undefined): string | null => {
  if (header === null || header === undefined) return null
  const value = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : header.trim()
  return value.startsWith(KEY_PREFIX) && value.length > KEY_PREFIX.length + 20 ? value : null
}
