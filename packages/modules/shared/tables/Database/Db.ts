/**
 * The org-scoping seam. Every tenant-scoped query in the application goes through here.
 *
 * Two layers of defence, because only one of them is checkable by the compiler:
 *
 * **1. The type system.** Every method returns an effect requiring `CurrentUser`, and none
 * accepts an `orgId` argument. So a caller cannot name a tenant — the org is read from the
 * authenticated identity or the query cannot be written at all.
 *
 * **2. Row-level security.** `scoped` opens a transaction and sets `app.current_org`, which the
 * `current_org()` function and every table policy read. A forgotten `WHERE organization_id = …`
 * therefore returns nothing rather than another tenant's rows.
 *
 * Neither is trusted alone. The type system cannot see inside a SQL string, and an RLS policy
 * can be missing from a new table — so the tenancy test asserts the *behaviour* for every store
 * method, and `bun run dep:check` asserts nothing reaches SQL outside this seam.
 */
import { CurrentOrg, CurrentUser, type OrgId } from "@ea/modules/shared/domain/Identity"
import { Context, Effect, Layer } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

export interface DbService {
  /**
   * Runs `f` inside a transaction with `app.current_org` set, so RLS applies.
   *
   * The org id is handed to `f` for use in explicit `WHERE` clauses — defence in depth, not a
   * substitute for the policy. `f` cannot choose a different one.
   */
  readonly scoped: <A, E>(
    f: (sql: SqlClient.SqlClient, orgId: OrgId) => Effect.Effect<A, E>
  ) => Effect.Effect<A, E | SqlError.SqlError, CurrentUser | SqlClient.SqlClient>

  /**
   * As `scoped`, for non-interactive work that has no session — a queue consumer or cron.
   *
   * Separate from `scoped` so `grep CurrentOrg` enumerates every place that acts without a
   * user, which is exactly the list a tenancy audit needs.
   */
  readonly scopedForOrg: <A, E>(
    f: (sql: SqlClient.SqlClient, orgId: OrgId) => Effect.Effect<A, E>
  ) => Effect.Effect<A, E | SqlError.SqlError, CurrentOrg | SqlClient.SqlClient>

  /**
   * Runs `f` with NO tenant scope. Deliberately conspicuous.
   *
   * Only for lookups where "which organization" is the *answer* rather than an input: resolving
   * a session token, or an API key by hash. Keep the body to a single statement, and never let
   * a value derived here choose a tenant without re-entering `scoped`.
   */
  readonly unscopedForAuth: <A, E>(
    f: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>
  ) => Effect.Effect<A, E | SqlError.SqlError, SqlClient.SqlClient>
}

/**
 * Opens a transaction with `app.current_org` set, so RLS applies for its duration.
 *
 * Module scope rather than inside the layer: it captures nothing, and hoisting it makes clear
 * that setting the GUC is one shared mechanism rather than per-construction behaviour.
 */
const withOrg = <A, E>(
  orgId: OrgId,
  f: (sql: SqlClient.SqlClient, orgId: OrgId) => Effect.Effect<A, E>
) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return yield* sql.withTransaction(
      Effect.gen(function*() {
        /*
         * Drop to the non-superuser role for the life of this transaction.
         *
         * Not belt-and-braces: **a superuser bypasses row-level security entirely, FORCE or not.**
         * Locally the Worker connects as the bootstrap user, so without this every policy in the
         * database is decoration and the app-layer predicate is the only thing standing between two
         * tenants. That is exactly how `Intake.list` came to return another organization's rows.
         *
         * `local` so it reverts with the transaction — the connection must not be left as a
         * different role for whatever runs next on it.
         */
        yield* sql`set local role effect_ai_app`
        // `true` scopes the setting to this transaction, so it cannot leak to the next user of
        // a pooled connection — which would attribute one tenant's queries to another.
        yield* sql`select set_config('app.current_org', ${orgId}, true)`
        return yield* f(sql, orgId)
      })
    )
  })

export class Db extends Context.Service<Db, DbService>()("tables/Db") {
  /**
   * The live seam. Kept a static on the tag so `Db.layer` is the only way to construct one —
   * a second construction path would be a second place tenant scoping could go wrong.
   */
  static readonly layer: Layer.Layer<Db> = Layer.effect(Db)(Effect.sync(() => {
    return {
      scoped: (f) => Effect.flatMap(CurrentUser, (identity) => withOrg(identity.orgId, f)),
      scopedForOrg: (f) => Effect.flatMap(CurrentOrg, (orgId) => withOrg(orgId, f)),
      unscopedForAuth: (f) => Effect.flatMap(SqlClient.SqlClient, f)
    } satisfies DbService
  }))
}
