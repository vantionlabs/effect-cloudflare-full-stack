/**
 * `api_keys`: how a program authenticates, as opposed to a person.
 *
 * **Only the hash is stored.** The plaintext is shown once, at creation, and never again — so a leaked database
 * row is not a credential. SHA-256 rather than a password hash on purpose: a key is 256 bits of randomness we
 * generated, not a memorable secret a human chose, so there is no dictionary to slow down and the lookup has to
 * happen on every request. Deliberately a different decision from better-auth's password hashing, for a
 * different threat.
 *
 * **A key ACTS AS a member.** `acts_as_user_id` is the person it authenticates as, which is what keeps one
 * `Identity` for both doors — every use case already requires `CurrentUser`, and audit columns like
 * `approved_by` need a real user rather than a synthetic one. The consequence is deliberate: revoking the
 * member's access revokes the key with it, because the key never had authority of its own.
 *
 * **Revoked, never deleted.** A key that signed a request a year ago has to stay explicable, and `last_used_at`
 * is the only way to answer "is anything still using this" before revoking it.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const ApiKeyTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    create table if not exists api_keys (
      id                 text primary key,
      -- No FK to better-auth's organization table; see TenancyTable.ts.
      organization_id    text not null,
      /*
       * The member this key acts as. No FK into better-auth's "user" table either, for the same reason — and
       * membership is re-read on every request, so a key whose member has been removed stops working without
       * anything here changing.
       */
      acts_as_user_id    text not null,
      /* What a person calls it in a list. Never used for lookup. */
      name               text not null,
      /*
       * SHA-256 of the presented key, hex. UNIQUE, so two keys cannot collide and a lookup is one index probe
       * on a value the client cannot influence beyond choosing its own key.
       */
      key_hash           text not null unique,
      /*
       * The first characters of the plaintext, so a list can show which key is which.
       *
       * Safe to store and necessary to keep short: it is a prefix of a secret, so a long one would narrow a
       * brute force. Eight characters of a 43-character base64url key leaves the rest intact.
       */
      prefix             text not null,
      created_at         timestamptz not null default now(),
      created_by_user_id text not null,
      /* Read on every authenticated request, so "is anything still using this" is answerable before revoking. */
      last_used_at       timestamptz,
      revoked_at         timestamptz
    )
  `

  /* Listing an organization's keys, which is the only query that is not by hash. */
  yield* sql`
    create index if not exists api_keys_org_idx on api_keys (organization_id, created_at desc)
  `
})
