#!/usr/bin/env bun
/**
 * Enforces the slice × role architecture, so the layering is checked rather than remembered.
 *
 * Why a script and not dependency-cruiser: the rules here are about *which package* an import
 * comes from, and Bun workspaces already make that the primary boundary. Adding another tool
 * to restate what `package.json` dependencies express would be redundant. This catches the
 * things package boundaries cannot: forbidden specifiers, and per-directory rules inside a
 * package.
 *
 *   bun scripts/boundaries.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = new URL("..", import.meta.url).pathname

interface Rule {
  readonly label: string
  /** Files this rule applies to, relative to the repo root. */
  readonly appliesTo: (path: string) => boolean
  /** Import specifiers that must not appear. */
  readonly forbidden: ReadonlyArray<{ readonly pattern: RegExp; readonly because: string }>
  /** Escape hatch for rules that depend on the importer as well as the specifier. */
  readonly permitted?: (path: string, specifier: string) => boolean
}

const COMPOSITION_ROOT = new Set([
  "apps/worker/src/Main.ts",
  "apps/worker/src/platform/DispatchEvent.ts",
  /*
   * The Durable Object class, which is a DEPLOYMENT ARTIFACT rather than an adapter.
   *
   * The runtime requires a class extending `DurableObject` from `cloudflare:workers`, exported from the
   * Worker's entry and declared in `exports` in wrangler.jsonc. `packages/modules` keeps platform globals
   * non-ambient on purpose, so the class cannot live there — but everything it *decides* does, in
   * `realtime/server/Room/RoomProtocol.ts`, which is why this file is glue and is allowed to name it.
   *
   * Added deliberately rather than by loosening the rule to a prefix: the point of an explicit set is that a
   * fourth entry is a decision somebody makes in a diff.
   */
  /*
   * The `Env` declaration, which names adapters' binding TYPES on purpose.
   *
   * That naming is the inversion the cleanup rests on: an adapter declares the one capability it needs
   * (`RoomsBinding`), and this file composes those into the deployment's environment — rather than adapters
   * importing `Env` and thereby depending on everything the deployment has. The dependency has to point one
   * way or the other, and this way is what allows an adapter to live in a module at all.
   *
   * Type-only, and worth keeping that way: a value import here would make the environment declaration
   * construct things, which is `Main.ts`'s job.
   */
  "apps/worker/src/platform/Bindings.ts",
  "apps/worker/src/RoomDurableObject.ts",
  /*
   * The authorization seam. The ONLY file that names a vendor and a feature together, which is what makes it
   * composition: better-auth verifies an API key, `IdentityForMember` checks the membership, and neither package
   * may name the other.
   */
  "apps/worker/src/platform/AuthenticatedLive.ts"
])

const MODULES = "packages/modules/"

/*
 * The package root, not `packages/modules/src/`, on purpose: every rule below keys on this prefix and must
 * keep covering `test/` as well as `src/`. Only the POSITIONAL parsing knows about `src/`, which is why the
 * two accessors below carry the offset and nothing else does.
 */
const SRC = 2

/** `packages/modules/src/<slice>/<ring>/...` → `<slice>`, or undefined outside the modules package. */
const sliceOf = (path: string): string | undefined => path.startsWith(MODULES) ? path.split("/")[SRC + 1] : undefined

/**
 * `packages/modules/src/<slice>/<ring>/...` → `<ring>`.
 *
 * The ring is a directory rather than a package now, so every rule that could once lean on a
 * package name keys on this instead — which makes this script the only thing keeping the rings
 * apart. See ADR-0011 for why that trade was taken.
 */
const ringOf = (path: string): string | undefined => path.startsWith(MODULES) ? path.split("/")[SRC + 2] : undefined

/** `@ea/modules/<slice>/<role>/...` → `<slice>`. */
const sliceOfSpecifier = (specifier: string): string | undefined =>
  /^@ea\/modules\/(iam|intake|decision|policy|shared)\//.exec(specifier)?.[1]

const rules: ReadonlyArray<Rule> = [
  {
    label: "infra stays free of Effect",
    appliesTo: (p) => p.startsWith("infra/"),
    forbidden: [
      {
        pattern: /^effect$|^effect\/|^@effect\//,
        because: "the Pulumi program shares nothing with the Worker, so depending on Effect would " +
          "buy no composition while exposing infrastructure to every RC churn — which is " +
          "precisely what blocked Alchemy"
      }
    ]
  },
  {
    label: "domain packages stay platform-free",
    appliesTo: (p) => ringOf(p) === "domain",
    forbidden: [
      {
        // `effect/http` is the SERVER runtime. `effect/http-api` is deliberately allowed: it
        // is a declarative contract DSL, and the whole point of putting the contract in a
        // domain package is that the browser client derives from the same declaration the
        // handlers are typed by. Whether server-only symbols leak into the client bundle is
        // a tree-shaking question, answered by the bundle assertion, not by this rule.
        pattern: /^effect\/http$|^effect\/http\//,
        because: "domain must not import the HTTP server runtime (effect/http-api is fine)"
      },
      { pattern: /^effect\/sql/, because: "domain must not know about persistence" },
      { pattern: /^@effect\/sql-/, because: "domain must not know about a database driver" },
      { pattern: /^cloudflare:/, because: "domain must be runnable in Node and the browser" },
      { pattern: /^node:/, because: "domain must be importable by the browser" },
      { pattern: /^@effect\/ai-/, because: "domain must not bind to an AI provider" }
    ]
  },
  {
    label: "the Worker never imports Bun platform packages",
    appliesTo: (p) => p.startsWith("apps/worker/src/"),
    forbidden: [
      {
        pattern: /^@effect\/platform-bun/,
        because: "the deployed Worker runs on workerd, not Bun; Bun is the toolchain only"
      },
      {
        pattern: /^@effect\/platform-node/,
        because: "the deployed Worker runs on workerd, not Node"
      }
    ]
  },
  /*
   * The composition root is TWO files, not one, and the split is forced rather than chosen.
   *
   * `Main.ts` composes the HTTP half. `DispatchEvent.ts` composes the queue half, and it has to be a
   * separate file because `WorkflowEnginePg` captures its connection and its tenant at layer build — so it
   * cannot live in the memoised app graph, and cannot be built before `ConsumeEvent` has resolved the
   * organization from the event row. Both name adapters; neither holds business logic beyond one `switch`.
   *
   * Kept as an explicit set rather than a prefix so that a third file cannot join by accident.
   */
  {
    label: "nothing but the composition root may reach into a server ring",
    appliesTo: (p) =>
      p.startsWith(MODULES) ||
      p.startsWith("packages/api/") ||
      (p.startsWith("apps/worker/src/") && !COMPOSITION_ROOT.has(p)),
    forbidden: [
      {
        pattern: /^@ea\/modules\/[a-z-]+\/server(\/|$)/,
        because: "an adapter may only be named by the composition root. A use case or another " +
          "slice that imports one has bound itself to a platform, and the fakes-only test tier " +
          "stops being possible. `evals/` is deliberately outside this rule: it is a composition " +
          "root of its own, and naming the deterministic embedder is the whole point of it"
      }
    ]
  },
  /**
   * A Durable Object may not reach a database — a COST boundary for a room, and a TENANCY one for an agent.
   *
   * An outbound `connect()` keeps a Durable Object resident and billable for up to 15 minutes, and our
   * Postgres client dials through `cloudflare:sockets` (ADR-0009). So a room that wrote to the database would
   * stay billable for a quarter of an hour after every message — Cloudflare's own examples put that at $412 a
   * month against $20 for the same traffic.
   *
   * A check rather than a comment because the failure is invisible: nothing errors, nothing logs, the code
   * reads fine, and the bill arrives a month later. See ADR-0019.
   *
   * **Extended to `AssistantAgent` when the Agents SDK arrived, and for an agent the stronger reason is not
   * cost.** An agent that streams from a model holds an outbound connection anyway — the 15-minute rule
   * exists so that model streaming is not cut off mid-answer — so residency is something it accepts by
   * nature and the cost argument alone would not settle it. What does settle it: **a Durable Object cannot
   * validate the identity it is handed** (ADR-0019), the corpus is tenant-scoped, and `Db.scoped` requires
   * `CurrentOrg`. An agent querying the corpus itself would be querying for an identity it cannot check, in
   * the one place the tenancy seam is not a compile error. See ADR-0025.
   */
  {
    label: "a Durable Object may not reach a database",
    appliesTo: (p) => p.startsWith("apps/worker/src/Room") || p.startsWith("apps/worker/src/Assistant"),
    forbidden: [
      {
        pattern: /^@effect\/sql|^pg$|^@ea\/modules\/[a-z-]+\/tables(\/|$)/,
        because: "a Durable Object must never hold a database connection. For a room it is cost: an " +
          "outbound connect() keeps the object resident and billable for up to 15 minutes, which defeats " +
          "hibernation and multiplies the cost of every room by about twenty. For an agent it is tenancy: " +
          "a Durable Object cannot validate the identity it is handed, and the corpus is tenant-scoped, so " +
          "it would query on behalf of an identity it cannot check. Either way the database work belongs " +
          "in the Worker, which resolves the session and owns connection lifetime per request; the object " +
          "is told what to broadcast or record afterwards (ADR-0019, ADR-0025)"
      }
    ]
  },
  /**
   * A capability package may not import a feature.
   *
   * This is the DIRECTION half of ADR-0021's rule — the reason `@ea/domain`, `@ea/database` and `@ea/realtime` are
   * packages at all. They are imported by every slice, so if one of them ever imports a slice the layout inverts
   * and nothing else in the repo would notice: the cycle typechecks, because it is all one build.
   *
   * `@ea/domain` additionally has no dependency to contain — its manifest lists `effect` and nothing else — which
   * is a property worth being able to read off the file rather than hoping for.
   */
  {
    label: "a capability package never imports a feature",
    appliesTo: (p) =>
      p.startsWith("packages/domain/") || p.startsWith("packages/database/") || p.startsWith("packages/realtime/"),
    forbidden: [
      {
        pattern: /^@ea\/modules(\/|$)/,
        because: "a capability is imported BY features and must never import one. `@ea/domain` holds identity and " +
          "ids; `@ea/database` holds the Db seam; `@ea/realtime` holds the socket. If one of them needs a " +
          "feature type, the cut was wrong — move the type down into the capability, do not bend the rule " +
          "(ADR-0021)"
      },
      {
        pattern: /^@ea\/api(\/|$)/,
        because: "the api package collects the modules' contracts, so a capability importing it is the same " +
          "inversion one level further out"
      }
    ]
  },
  /**
   * Only the composition root may name a vendor.
   *
   * The `server`-ring version of this rule has always existed — an adapter may only be named by the composition
   * root — and moving better-auth and OpenAI into their own packages took them out of its reach, because it matches
   * `@ea/modules/<slice>/server`. Without this, a use case could import `@ea/better-auth` directly and put the SDK
   * back into the module graph the packages exist to keep it out of (ADR-0021).
   *
   * `evals/` is exempt for the same reason it is exempt from the server rule: it is a composition root of its own.
   */
  {
    label: "nothing but the composition root may name an integration",
    appliesTo: (p) =>
      (p.startsWith(MODULES) || p.startsWith("packages/api/") || p.startsWith("packages/domain/") ||
        p.startsWith("packages/database/") || p.startsWith("packages/realtime/") ||
        (p.startsWith("apps/worker/src/") && !COMPOSITION_ROOT.has(p))) &&
      !p.includes("/test/"),
    forbidden: [
      {
        pattern: /^@ea\/(better-auth|ai-openai|resend)(\/|$)/,
        because: "an integration package owns a vendor SDK, and only the composition root may choose a vendor. " +
          "Importing one here would bind this code to it and drag the SDK back into the graph — which is what " +
          "these packages were created to prevent (ADR-0021). Depend on the PORT instead; `@ea/domain` holds the " +
          "identity ports, and a feature's own ports live in its domain ring"
      }
    ]
  },
  /**
   * An integration may reach a DOMAIN ring and nothing deeper.
   *
   * An adapter implements a port, and ports live in domain rings — `@ea/domain` for identity, a slice's own domain
   * for anything else (a future Stripe adapter implements `modules/billing/domain/Payments`). Reaching a use case or
   * another slice's server ring would make the adapter a participant in the feature rather than an implementation
   * of its contract.
   */
  {
    label: "an integration implements ports, it does not use features",
    appliesTo: (p) => p.startsWith("packages/integrations/"),
    forbidden: [
      {
        pattern: /^@ea\/modules\/[a-z-]+\/(use-cases|tables|server)(\/|$)/,
        because: "an adapter implements a PORT. Ports live in domain rings; a use case, a table or another " +
          "adapter is not one, and importing it makes the vendor code part of the feature"
      },
      {
        pattern: /^@ea\/api(\/|$)/,
        because: "the api package collects contracts and edges; an adapter sits below it, not beside it"
      }
    ]
  },
  {
    label: "modules never depend on the api package",
    appliesTo: (p) => p.startsWith(MODULES),
    forbidden: [
      {
        pattern: /^@ea\/api(\/|$)/,
        because: "the api package COLLECTS the modules' groups, so the dependency runs api -> " +
          "modules and only that way. The reverse is a cycle, and it does not fail loudly: the " +
          "barrel re-exports the handler files, so `ApiV1` arrives undefined and every request " +
          "dies with `Cannot read properties of undefined (reading 'groups')`. Reach the manifest " +
          "by relative path from inside packages/api instead"
      }
    ]
  },
  {
    label: "the api package imports contracts and use cases, never adapters",
    appliesTo: (p) => p.startsWith("packages/api/"),
    forbidden: [
      {
        pattern: /^@effect\/sql-|^cloudflare:|^pg$/,
        because: "the transport edge calls use cases; it does not own connections or bindings. " +
          "Those belong to apps/worker/src/platform"
      }
    ]
  },
  {
    label: "tables rings stay driver-free",
    appliesTo: (p) => ringOf(p) === "tables",
    forbidden: [
      {
        pattern: /^@effect\/sql-/,
        because: "a migration must run against whatever client the caller has — the Worker's " +
          "Hyperdrive one in production, a plain one in the eval harness. Naming a driver here " +
          "would tie the schema to the deployment"
      },
      { pattern: /^cloudflare:/, because: "migrations must be runnable from Node" }
    ]
  },
  {
    label: "a slice never reaches into another slice",
    appliesTo: (p) => p.startsWith(MODULES),
    forbidden: [
      {
        pattern: /^@ea\//,
        because: "slices compose through `shared`, never directly. A genuinely cross-slice type " +
          "belongs in shared/domain (as Identity and Authenticated do); anything else is a " +
          "boundary that has not been thought about yet"
      }
    ],
    // Permitted: within your own slice, and anything depending on `shared`. Plus the two
    // composition points, which exist precisely to name every slice — `shared/api` composes the
    // groups into one contract, and `Migrations.ts` is the one place migration order is decided.
    permitted: (path, specifier) => {
      if (path.startsWith("packages/modules/src/shared/api/")) return true
      if (path === "packages/modules/src/shared/tables/Migrations/Migrations.ts") return true
      const target = sliceOfSpecifier(specifier)
      return target === undefined || target === "shared" || target === sliceOf(path)
    }
  },
  {
    label: "only the platform directory may open sockets or touch the driver",
    appliesTo: (p) => p.startsWith("apps/worker/src/") && !p.includes("/platform/"),
    forbidden: [
      {
        pattern: /^cloudflare:sockets$/,
        because: "socket handling belongs in platform/CloudflareSocket.ts"
      },
      {
        pattern: /^@effect\/sql-pg$/,
        because: "the Postgres driver belongs in platform/HyperdriveConnect.ts, which owns connection lifetime"
      }
    ]
  }
]

const walk = (dir: string): Array<string> => {
  const out: Array<string> = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (/\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

const importPattern = /(?:from|import)\s+"([^"]+)"/g

const failures: Array<string> = []
let checked = 0

for (const dir of ["packages", "apps", "infra"]) {
  for (const absolute of walk(join(root, dir))) {
    const path = relative(root, absolute)
    if (path.includes("/test/")) continue
    const source = readFileSync(absolute, "utf8")
    const specifiers = [...source.matchAll(importPattern)].map((m) => m[1]!)

    for (const rule of rules) {
      if (!rule.appliesTo(path)) continue
      checked++
      for (const specifier of specifiers) {
        if (rule.permitted?.(path, specifier) === true) continue
        for (const { pattern, because } of rule.forbidden) {
          if (pattern.test(specifier)) {
            failures.push(`${path}\n    imports "${specifier}"\n    ${because}\n    rule: ${rule.label}`)
          }
        }
      }
    }
  }
}

/*
 * Exactly one place may CONSTRUCT a `decision.execute` event.
 *
 * Note what this does and does not assert. Two CALLERS are correct and expected — the human approval path
 * and the auto-approve branch — because them sharing one path is the whole point. What must be unique is the
 * place that builds the event, since a second constructor is how the two paths would silently diverge into
 * "automatic" and "approved" as two features that merely resemble each other.
 *
 * A first version of this check counted callers and failed at 2, which was the check being wrong rather than
 * the code.
 */
const executeEventConstructors = (): Array<string> => {
  const sites: Array<string> = []
  for (const absolute of walk(join(root, "packages"))) {
    const path = relative(root, absolute)
    if (path.includes("/test/")) continue
    const source = readFileSync(absolute, "utf8")
    // The literal that identifies the event being built, not a type annotation mentioning it.
    for (const _ of source.matchAll(/type:\s*"decision\.execute"/g)) sites.push(path)
  }
  return sites
}

/*
 * Every SQL statement touching a tenant table must filter on the organization.
 *
 * This check IS the tenancy guarantee now. Row-level security used to be the second net — a forgotten
 * predicate returned nothing instead of another tenant's rows — and it was removed deliberately (ADR-0014)
 * because better-auth provides the organization but not the isolation, and the role machinery it needed was
 * refused by the managed provider anyway.
 *
 * So the property RLS gave for free is checked here instead. When it was written, **16 statements across 8
 * files had no predicate** and RLS was silently carrying all of them, including reads of `extractions` and
 * `workflow_activities` — both of which hold extracted invoice fields. That is the size of the hole this
 * closes, and the reason it is a hard failure rather than a warning.
 *
 * Writes are satisfied by supplying `organization_id` as a column; reads, updates and deletes need a WHERE.
 */
/**
 * Every table carrying `organization_id`. **A table missing from this list is not checked at all.**
 *
 * That is this rule's silent failure, and it had already happened: the whole chat slice — `rooms`, `messages`,
 * `message_reactions`, `message_mentions`, `room_reads` — was absent, so none of its queries were ever read by
 * the tenancy check. Found while adding `api_keys` and noticing the exempt count had not changed.
 *
 * The list is derivable — `rg "create table if not exists" | grep organization_id` — but it stays explicit,
 * because deriving it would mean a table that FORGOT `organization_id` silently leaves the rule's scope, which
 * is the same failure one level down. Adding a tenant table means adding a line here, and `scripts/db-verify`
 * printing a table this list does not name is the signal.
 */
const TENANT_TABLES = new Set([
  "source_documents",
  "intakes",
  "document_chunks",
  "extractions",
  "decisions",
  "decision_citations",
  "rules",
  "executions",
  "events",
  "workflow_executions",
  "workflow_activities",
  // The chat slice. Absent until 2026-09-30, so every query below was unchecked.
  "rooms",
  "messages",
  "message_reactions",
  "message_mentions",
  "room_reads",
  // Usage metering. Listed from its first migration, so no query against it was ever unchecked.
  "usage_records",
  // The weekly report's delivery claims.
  "report_deliveries",
  // Sales.
  "products",
  "quotes",
  "quote_lines",
  "change_proposals",
  "jobs",
  "invoices",
  "customer_terms",
  "expenses"
  /*
   * better-auth's `apikey` is deliberately NOT here. It is not ours — the `@better-auth/api-key` plugin owns it,
   * it has no `organization_id` column (ownership is `referenceId`), and no query in this repo touches it: the
   * plugin's own API does. The same reasoning as `user`, `session` and `member`.
   */
])

/**
 * The one legitimate exemption, and it has to be written INTO the SQL.
 *
 * Some reads cannot filter by tenant because the tenant is what they are asking for — resolving a session
 * token, an API key by hash, or the organization that owns a queued event, which arrives as an id and
 * nothing else (a message that named its own organization would be a hole in the seam).
 *
 * So the escape is an explicit marker inside the statement rather than a path or a wrapper this script
 * tries to infer. Three properties follow, all of them wanted: the author has to write the claim down next
 * to the query, `rg "tenant: the organization is the answer"` is the complete list, and the count is
 * printed on every run so growth is visible rather than quiet.
 */
const TENANT_IS_THE_ANSWER = "tenant: the organization is the answer"

const unscopedTenantQueries = (): { readonly found: Array<string>; readonly exempt: Array<string> } => {
  const found: Array<string> = []
  const exempt: Array<string> = []
  for (const absolute of walk(join(root, "packages"))) {
    const path = relative(root, absolute)
    // Migrations legitimately touch these tables without a tenant: they create them.
    if (path.includes("/test/") || path.includes("/tables/") || path.endsWith("Db.ts")) continue
    const source = readFileSync(absolute, "utf8")

    /*
     * `[\s\S]*?` for the generic annotation, NOT `[^>]*`.
     *
     * The first version stopped the annotation at the first `>`, so a statement whose row type spans
     * multiple lines or contains a nested generic never matched — and an unmatched statement is **silently
     * skipped**, which is the worst possible failure for a rule like this. Measured when it was fixed:
     * 26 tenant statements seen before, **30 after**. The four it had never looked at included
     * `ListQueue`'s two reads of `decisions` and the `rules` read added when rail 3 started evaluating
     * conditions.
     *
     * Found by writing a negative test that kept passing: patching a statement to use a caller-supplied
     * org produced no failure, because the statement was not being read at all.
     */
    for (const match of source.matchAll(/sql(?:<[\s\S]*?>)?\s*`([^`]*)`/g)) {
      const body = match[1]!
      const lower = body.toLowerCase()
      const tables = [...body.matchAll(/(?:from|into|update)\s+([a-z_]+)/g)]
        .map((table) => table[1]!)
        .filter((table) => TENANT_TABLES.has(table))
      if (tables.length === 0) continue

      const isInsert = lower.includes("insert into")
      const scoped = isInsert
        // Same reasoning as the read branch below: the identifier may be renamed, the intent may not.
        ? lower.includes("organization_id") && /\$\{[a-z_]*orgid\}/.test(lower)
        /*
         * Any identifier ENDING in `orgId`, with no dots — so `${orgId}` and `${scopedOrgId}` both pass
         * while `${input.orgId}` does not.
         *
         * It used to require the literal name `orgId`, and renaming a shadowed callback parameter in
         * `WorkflowEnginePg` to `scopedOrgId` silently un-matched six statements and failed this check. A
         * rule that mandates a variable name is checking spelling, not scoping. The no-dots part is what
         * keeps the intent: the value has to be the one the seam handed the callback, not something reached
         * through a caller-supplied object — which is the hole `Db` exists to close.
         */
        : /organization_id\s*=\s*\$\{[A-Za-z_]*[Oo]rgId\}/.test(body)

      if (!scoped) {
        if (body.includes(TENANT_IS_THE_ANSWER)) {
          exempt.push(`${path} — ${[...new Set(tables)].join(", ")}`)
        } else {
          found.push(`${path}\n      touches ${[...new Set(tables)].join(", ")} without an organization filter`)
        }
      }
    }
  }
  return { found, exempt }
}

const tenantQueries = unscopedTenantQueries()

/*
 * Printed even when empty, so the number is part of the check's output rather than something a reader has
 * to go looking for. An exemption list that grows is the signal; one that grows silently is the problem.
 */
if (tenantQueries.exempt.length > 0) {
  console.log(
    `  ${tenantQueries.exempt.length} statement(s) exempt as "${TENANT_IS_THE_ANSWER}":`
  )
  for (const entry of tenantQueries.exempt) console.log(`    ${entry}`)
}

for (const unscoped of tenantQueries.found) {
  failures.push(
    `${unscoped}\n    Reads, updates and deletes need \`and organization_id = \${orgId}\`; inserts need the\n` +
      "    column supplied. `Db.scoped` hands you orgId as the second argument — use it. There is no RLS\n" +
      `    behind this any more (ADR-0014). If the tenant is genuinely what the query ASKS FOR, put\n` +
      `    "-- ${TENANT_IS_THE_ANSWER}" inside the statement and keep it to a single point lookup.`
  )
}

/*
 * `ConsumeEvent` is privileged: it resolves the tenant from the event row with an unscoped lookup, so an
 * ambient organization has no effect on it. That is correct for a queue consumer, which has no session —
 * and it means anything that can call it with an event id acts as that event's organization.
 *
 * So it must not be reachable from a request path, and that is checked rather than trusted. The allow-list
 * is exactly one file: the Worker's queue dispatch.
 */
const CONSUME_EVENT_ALLOWED = new Set([
  "apps/worker/src/platform/DispatchEvent.ts",
  "packages/modules/src/shared/use-cases/Event/index.ts"
])

const consumeEventImporters = (): Array<string> => {
  const found: Array<string> = []
  for (const dir of ["packages", "apps"]) {
    for (const absolute of walk(join(root, dir))) {
      const path = relative(root, absolute)
      if (path.includes("/test/") || path.endsWith("ConsumeEvent.ts")) continue
      if (CONSUME_EVENT_ALLOWED.has(path)) continue
      const source = readFileSync(absolute, "utf8")
      /*
       * IMPORTS, not mentions. The first version matched the identifier anywhere and flagged
       * `QueueHandler.ts` for naming `ConsumeEvent` in a docstring — a false positive that would have
       * taught the next reader to weaken the rule rather than trust it.
       */
      const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)]
        .some((match) => /\bConsumeEvent\b/.test(match[1]!))
      if (imports) found.push(path)
    }
  }
  return found
}

for (const importer of consumeEventImporters()) {
  failures.push(
    `${importer}\n    imports ConsumeEvent, which is PRIVILEGED: it takes its tenant from the event row\n` +
      "    rather than from the caller, so anything that can name an event id acts as that event's\n" +
      "    organization. It belongs to the queue dispatch only. If a request path needs to trigger work,\n" +
      "    emit an event instead — EmitEvent is scoped to the caller."
  )
}

const emitSites = executeEventConstructors()
if (emitSites.length !== 1) {
  failures.push(
    `a decision.execute event is constructed in ${emitSites.length} place(s), expected exactly 1:\n` +
      emitSites.map((site) => `      ${site}`).join("\n") +
      "\n    Both approval paths must reach execution through ONE emit, or \"the automatic path does\n" +
      "    the same thing\" is an assertion nobody checks."
  )
}

if (failures.length > 0) {
  console.error(`✗ ${failures.length} boundary violation(s):\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}

console.log(`✓ boundaries clean (${checked} file-rule checks)`)
