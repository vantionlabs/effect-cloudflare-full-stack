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
import { makeAuth } from "../apps/worker/src/iam/auth.ts"

/** A throwaway config: only the plugin list affects the emitted schema. */
const auth = makeAuth({
  connectionString: "postgresql://unused:unused@localhost:1/unused",
  baseURL: "http://localhost",
  secret: "schema-generation-only"
})

const tables = getAuthTables(auth.options)

/** better-auth field types → Postgres column types. */
const columnType = (type: string, isBigint: boolean): string => {
  if (isBigint) return "bigint"
  switch (type) {
    case "string":
      return "text"
    case "number":
      return "integer"
    case "boolean":
      return "boolean"
    case "date":
      return "timestamptz"
    default:
      // An unmapped type must stop the build rather than silently become text: a wrong column
      // type surfaces as a runtime coercion bug far from its cause.
      throw new Error(`Unmapped better-auth field type "${type}" — extend columnType()`)
  }
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

for (const [, table] of Object.entries(tables)) {
  const columns: Array<string> = [`  ${q("id")} text primary key`]

  for (const [fieldName, field] of Object.entries(table.fields)) {
    const f = field as {
      type: string
      required?: boolean
      unique?: boolean
      bigint?: boolean
      references?: { model: string; field: string; onDelete?: string }
      fieldName?: string
    }
    const name = f.fieldName ?? fieldName
    const parts = [`  ${q(name)} ${columnType(f.type, f.bigint === true)}`]
    if (f.required === true) parts.push("not null")
    if (f.unique === true) parts.push("unique")
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

// Index every foreign key: better-auth queries sessions by userId and members by
// organizationId on the hot authentication path.
for (const [, table] of Object.entries(tables)) {
  for (const [fieldName, field] of Object.entries(table.fields)) {
    const f = field as { references?: unknown; fieldName?: string }
    if (f.references === undefined) continue
    const name = f.fieldName ?? fieldName
    statements.push(
      `create index if not exists ${q(`${table.modelName}_${name}_idx`)} on ${q(table.modelName)} (${q(name)})`
    )
  }
}

// better-auth reads and writes these itself, so the app role needs full access.
const tableNames = Object.values(tables).map((t) => t.modelName)
statements.push(
  `grant select, insert, update, delete on ${tableNames.map(q).join(", ")} to effect_ai_app`
)

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

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

${statements.map((s) => `  yield* sql\`\n    ${s.split("\n").join("\n    ")}\n  \``).join("\n\n")}
})
`

const target = new URL(
  "../packages/shared/database/src/migrations/0003_auth.ts",
  import.meta.url
).pathname

if (process.argv.includes("--check")) {
  const existing = readFileSync(target, "utf8")
  if (existing.trim() !== body.trim()) {
    console.error(
      "✗ 0003_auth.ts has drifted from the installed better-auth schema.\n" +
        "  better-auth probably changed its tables. Run `bun scripts/auth-schema.ts`, review the\n" +
        "  diff, and commit it as a migration rather than editing the file by hand."
    )
    process.exit(1)
  }
  console.log(`✓ auth schema matches the installed better-auth (${tableNames.length} tables)`)
} else {
  await Bun.write(target, body)
  console.log(`wrote 0003_auth.ts — ${tableNames.length} tables: ${tableNames.join(", ")}`)
}
