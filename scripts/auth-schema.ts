#!/usr/bin/env bun
/**
 * Generates the better-auth migration from the INSTALLED library, not from the CLI.
 *
 * `@better-auth/cli` is at 1.4.21 while `better-auth` is 1.7.6 — three minors behind — so its
 * generated schema may not match what the library actually reads at runtime. `getAuthTables`
 * comes from the installed package itself and reflects the configured plugins, so it cannot
 * drift from the code that will query these tables.
 *
 * `effect/sql`'s Migrator stays authoritative for every table including better-auth's: one
 * migration system, one database. `better-auth migrate` is never run (plan risk R9).
 *
 *   bun scripts/auth-schema.ts            # print the DDL
 *   bun scripts/auth-schema.ts --check    # fail if the committed migration has drifted
 */
import { getAuthTables } from "better-auth/db"
import { readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { makeAuth } from "../packages/integrations/better-auth/Session/BetterAuth.ts"

/** A throwaway config: only the plugin list affects the emitted schema. */
const auth = makeAuth({
  connectionString: "postgresql://unused:unused@localhost:1/unused",
  baseURL: "http://localhost",
  secret: "schema-generation-only"
})

const tables = getAuthTables(auth.options)

/**
 * better-auth field types → Postgres column types.
 *
 * Verified against `organization + twoFactor + admin + jwt`, `rateLimit: { storage: "database" }`
 * and custom `user.additionalFields`, which between them emit only string/number/boolean/date.
 * An unmapped type **throws** rather than defaulting to text: a wrong column type surfaces as a
 * runtime coercion bug far from its cause, so failing the build is cheaper.
 */
const columnType = (type: string | ReadonlyArray<string>, isBigint: boolean): string => {
  if (isBigint) return "bigint"
  // A plugin may declare an enum as an array of literals.
  if (Array.isArray(type)) return "text"
  switch (type) {
    case "string":
      return "text"
    case "number":
      return "integer"
    case "boolean":
      return "boolean"
    case "date":
      return "timestamptz"
    case "string[]":
    case "number[]":
      return "jsonb"
    default:
      throw new Error(
        `Unmapped better-auth field type "${String(type)}" — extend columnType(). This means a ` +
          `plugin introduced a type this generator has not seen; guessing would be worse.`
      )
  }
}

/** A literal SQL default, or undefined when better-auth computes the value in application code. */
const sqlDefault = (value: unknown): string | undefined => {
  if (typeof value === "function" || value === undefined) return undefined
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  return undefined
}

/**
 * Quotes an identifier, which is mandatory here for two reasons that both fail silently:
 *
 * 1. `user` is a **reserved word** in Postgres, so `create table user` is a syntax error.
 * 2. Postgres folds unquoted identifiers to lowercase, so `emailVerified` would become
 *    `emailverified` — while better-auth's Kysely adapter queries `"emailVerified"` and finds
 *    nothing. The table would exist and every read would fail.
 */
const q = (identifier: string) => `"${identifier}"`

const statements: Array<string> = []
/** Columns better-auth explicitly asks to be indexed, plus every foreign key. */
const indexed: Array<{ table: string; column: string }> = []

for (const [, table] of Object.entries(tables)) {
  const columns: Array<string> = [`  ${q("id")} text primary key`]

  for (const [fieldName, field] of Object.entries(table.fields)) {
    const f = field as {
      type: string | ReadonlyArray<string>
      required?: boolean
      unique?: boolean
      bigint?: boolean
      index?: boolean
      defaultValue?: unknown
      onUpdate?: unknown
      references?: { model: string; field: string; onDelete?: string }
      fieldName?: string
    }
    const name = f.fieldName ?? fieldName
    const parts = [`  ${q(name)} ${columnType(f.type, f.bigint === true)}`]
    if (f.required === true) parts.push("not null")
    if (f.unique === true) parts.push("unique")
    // An enum declared as literals becomes text plus a CHECK, so the database rejects a value
    // better-auth would never produce rather than storing it.
    if (Array.isArray(f.type)) {
      parts.push(`check (${q(name)} in (${f.type.map((v) => `'${v}'`).join(", ")}))`)
    }
    const literal = sqlDefault(f.defaultValue)
    if (literal !== undefined) parts.push(`default ${literal}`)
    // `onUpdate` is applied by better-auth in application code (it writes updatedAt itself), so
    // it needs no trigger here. Recorded so a future reader does not assume it was missed.
    if (f.index === true) indexed.push({ table: table.modelName, column: name })
    if (f.references !== undefined) indexed.push({ table: table.modelName, column: name })
    if (f.references !== undefined) {
      // References BETWEEN better-auth's own tables are kept: they are internally consistent
      // and upgraded together. What we never add is a FK from OUR tables into theirs.
      const onDelete = f.references.onDelete ?? "cascade"
      parts.push(`references ${q(f.references.model)}(${q(f.references.field)}) on delete ${onDelete}`)
    }
    columns.push(parts.join(" "))
  }

  statements.push(
    `create table if not exists ${q(table.modelName)} (\n${columns.join(",\n")}\n)`
  )
}

// Indexes come from better-auth's own `index` metadata plus every foreign key — it knows which
// columns are on the hot authentication path (sessions by userId, members by organizationId)
// better than a guess would. Deduplicated because a field can be both indexed and a reference.
const seen = new Set<string>()
for (const { table, column } of indexed) {
  const key = `${table}.${column}`
  if (seen.has(key)) continue
  seen.add(key)
  statements.push(
    `create index if not exists ${q(`${table}_${column}_idx`)} on ${q(table)} (${q(column)})`
  )
}

/*
 * No grant is emitted. There is no application role to grant to.
 *
 * This used to hand `effect_ai_app` full access to better-auth's tables, because RLS required a
 * non-superuser role for policies to apply at all. RLS was removed (ADR-0014) and so was the role — and on
 * PlanetScale it never existed, which is how this was found: migration 3 failed with
 * `role "effect_ai_app" does not exist` on the first run against the real database. Local Postgres still had
 * the role lying around from earlier migrations, so the local suite passed.
 *
 * A reminder that a migration suite which only ever runs against one database has not been tested.
 */
const tableNames = Object.values(tables).map((t) => t.modelName)
void tableNames

const body = `/**
 * better-auth's schema. GENERATED — do not hand-edit.
 *
 * Produced by \`bun scripts/auth-schema.ts\` from the INSTALLED better-auth via
 * \`getAuthTables\`, not from @better-auth/cli (which lags the library by three minors and could
 * emit a schema the runtime does not expect).
 *
 * Regenerate after any better-auth upgrade or plugin change; \`bun run auth:check\` fails CI if
 * this file has drifted from what the installed library implies.
 *
 * These tables are better-auth's. Ours carry \`organization_id\` with NO foreign key into them,
 * so their upgrades never become our migration problem (plan risk R9).
 */
import { Effect } from "effect"
import { SqlClient } from "effect/sql"

export const SessionTable = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

${statements.map((s) => `  yield* sql\`\n    ${s.split("\n").join("\n    ")}\n  \``).join("\n\n")}
})
`

const target = new URL(
  "../packages/modules/iam/tables/Session/SessionTable.ts",
  import.meta.url
).pathname

if (process.argv.includes("--check")) {
  const existing = readFileSync(target, "utf8")
  if (existing.trim() !== body.trim()) {
    console.error(
      "✗ SessionTable.ts has drifted from the installed better-auth schema.\n" +
        "  better-auth probably changed its tables. Run `bun scripts/auth-schema.ts`, review the\n" +
        "  diff, and commit it as a migration rather than editing the file by hand."
    )
    process.exit(1)
  }
  console.log(`✓ auth schema matches the installed better-auth (${tableNames.length} tables)`)
} else {
  await writeFile(target, body, "utf8")
  console.log(`wrote SessionTable.ts — ${tableNames.length} tables: ${tableNames.join(", ")}`)
}
