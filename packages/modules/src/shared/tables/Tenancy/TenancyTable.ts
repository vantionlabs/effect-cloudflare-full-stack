/**
 * The one thing every other migration needs: the `vector` extension.
 *
 * This file used to hold the tenancy machinery — a `current_org()` function, an `effect_ai_app` role, and the
 * row-level-security policies keyed on them. All of it is gone (ADR-0014). The decision and its consequences
 * are recorded there; the short version is that better-auth supplies the organization but not the isolation,
 * the role could not be created on the managed provider anyway, and the property RLS gave for free — a
 * forgotten predicate returning nothing rather than another tenant's rows — is now enforced by
 * `bun run dep:check` instead.
 *
 * `create extension` is idempotent and is the earliest migration because the vector column in
 * `document_chunks` depends on it.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const TenancyTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  /*
   * pgvector, as a migration rather than a manual step.
   *
   * It was created by hand once and a fresh database then silently lacked it — which surfaces as a confusing
   * type error on the vector column rather than as a missing extension.
   */
  yield* sql`create extension if not exists vector`
})
