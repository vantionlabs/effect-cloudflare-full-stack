/**
 * The tenancy foundation: what every tenant-scoped table depends on.
 *
 * Deliberately does NOT create `organization` or `member`. **better-auth's CLI generates and
 * owns those** (`@better-auth/cli generate`), and its output is pasted in as a later migration
 * at build-order step 3. Hand-writing provisional copies here would mean writing tables twice
 * and reconciling them later.
 *
 * It follows that tenant tables carry `organization_id text not null` with an index and **no
 * foreign key** to better-auth's `organization`. That is a deliberate choice, recorded as risk
 * R9 in the plan: a cross-boundary FK would turn their schema upgrade into our migration
 * problem. Postgres also cannot enforce a FK we do not declare, so the guard is RLS plus the
 * type-level seam, not referential integrity.
 *
 * Migrations are TypeScript modules rather than `.sql` files because `Migrator.fromFileSystem`
 * needs a filesystem and a Worker has none (`FileSystem.layerNoop`). `fromRecord` takes
 * modules, so one set of migrations runs in the Worker, in Node for the eval harness, and in CI.
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  /**
   * The tenant guard every RLS policy reads.
   *
   * Returns NULL when unset, which is the important part: a policy comparing
   * `organization_id = current_org()` then matches nothing, so a query that somehow escapes the
   * `Db` seam sees zero rows rather than every tenant's. Failing closed is the only acceptable
   * default.
   *
   * STABLE rather than IMMUTABLE: the value varies across a transaction's lifetime.
   */
  yield* sql`
    create or replace function current_org() returns text as $$
      select nullif(current_setting('app.current_org', true), '')
    $$ language sql stable
  `

  /**
   * A non-superuser role for the application.
   *
   * RLS is bypassed by superusers and, unless forced, by a table's owner — so an app connecting
   * as the owner would have policies that exist and do nothing. Tests and the eval harness use
   * this role for the same reason.
   */
  yield* sql`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'effect_ai_app') then
        create role effect_ai_app nologin;
      end if;
    end
    $$
  `
})
