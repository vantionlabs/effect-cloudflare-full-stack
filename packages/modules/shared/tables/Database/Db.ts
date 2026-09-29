/**
 * The org-scoping seam. Every tenant-scoped query in the application goes through here.
 *
 * **There is one net, and this is it.** There used to be two — row-level security policies keyed on a
 * transaction-local GUC, plus the predicate — and RLS was removed deliberately (ADR-0014). So the honest
 * description of the guarantee is:
 *
 * **What this seam does give you.** Every method hands `orgId` to its callback, and none accepts one as an
 * argument. There is no overload taking an `orgId`, so **a caller cannot name a tenant** — the organization
 * comes from the authenticated session or from an explicit non-interactive tag, never from a parameter a bug
 * or a crafted request could influence. That is structural, and it is the part worth having.
 *
 * **What it does not.** A query that simply omits `and organization_id = ${orgId}` will return other tenants'
 * rows. Under RLS it returned nothing. That property is now enforced by `bun run dep:check`, which fails on
 * any statement touching a tenant table without the predicate — and which found **16 such statements** the
 * day RLS came out, including reads of `extractions` and `workflow_activities`, both of which hold extracted
 * invoice fields. Treat that check as load-bearing rather than tidy.
 */
import { CurrentOrg, CurrentUser, type OrgId } from "@ea/modules/shared/domain/Identity"
import { Context, Effect, Layer } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

export interface DbService {
  /**
   * Runs `f` inside a transaction, with the caller's organization id.
   *
   * The id is handed to `f` for its `WHERE` clauses and is the ONLY thing scoping the query. `f` cannot
   * choose a different one — that is the guarantee this seam provides.
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
 * Opens a transaction and runs `f` with the organization id.
 *
 * A transaction even though nothing here sets session state any more: the callbacks frequently write more
 * than one row — a document and its intake, a decision and its citations — and those must land together.
 *
 * Module scope rather than inside the layer because it captures nothing, which makes clear that this is one
 * shared mechanism rather than per-construction behaviour.
 */
const withOrg = <A, E>(
  orgId: OrgId,
  f: (sql: SqlClient.SqlClient, orgId: OrgId) => Effect.Effect<A, E>
) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    return yield* sql.withTransaction(
      Effect.gen(function*() {
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
