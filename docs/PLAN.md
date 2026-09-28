# effect-ai — Effect v4 on Cloudflare Workers + PlanetScale Postgres

> Committed copy of the working plan. Build order progress is tracked at the bottom of the
> **Build order** section; ADRs that supersede a decision here are named inline.

## Context

`ai-projects/` holds one folder per portfolio build, each becoming its own repo. `docket/`
is the Python build that works — FastAPI + Celery + Postgres/pgvector — a document-decisioning
product whose point is the refusal: it knows when it is _not_ allowed to decide, says why, and
escalates, and every automatic decision carries a citation someone can audit a year later.

`effect-ai` is **a separate new project**, not a replacement. It rebuilds docket's problem shape
— extraction with verbatim provenance, policy retrieval, a closed outcome enum with mandatory
citations, hard rails, a human review queue — on Effect v4, deployed to Cloudflare Workers, with
PlanetScale Postgres behind Hyperdrive. docket and its in-flight `web/` rebuild continue untouched.

**Why the architecture fits.** docket's spec §6 already rejects durable suspend:

> "The design: do not suspend. Split at the human boundary and let the event row be the
> checkpoint." … "keeps every workflow short-lived, survives deploys with no special handling,
> and means a pending decision is a database row anyone can query rather than a suspended
> coroutine somebody has to trust."

That is the Workers execution model, written down before Workers was the target. The workload
also suits it on four independent axes: it is **I/O-bound** (45 s of waiting on model calls costs
~200 ms of billed CPU), it **idles at zero** on the compute side, the **unit of work is one
document**, and the data is small with simple queries.

## Decisions taken

| Question                       | Decision                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Relationship to docket         | Separate project; docket untouched                                                                                  |
| Compute                        | Cloudflare Workers — one deploy, one origin                                                                         |
| **Relational + vectors + FTS** | **PlanetScale Postgres via Hyperdrive**, created from the Cloudflare dashboard and billed on the Cloudflare invoice |
| Vector search                  | **pgvector 0.8.5** (+ `pgvectorscale`). **Not** Vectorize                                                           |
| Full-text                      | Postgres `to_tsvector('dutch', …)` — real Snowball stemming                                                         |
| Blobs / queues / cache         | R2 / Cloudflare Queues / KV                                                                                         |
| Exact rate limiting            | A Durable Object per API key                                                                                        |
| Shape                          | **API-first.** The Worker is the product; the UI is a reference client                                              |
| Frontend                       | TanStack Start via `@cloudflare/vite-plugin`, Workers Assets, same Worker                                           |
| Auth                           | better-auth on Postgres + KV session cache                                                                          |
| AI providers                   | **Two profiles**: `openrouter` (agnostic) and `mistral-eu` (EU-resident, direct)                                    |
| Document parsing               | Three tiers: native text → `anydoc` WASM → Mistral OCR                                                              |
| Durable execution              | `effect/workflow` + a ~200-line custom engine. **No `effect/cluster`**                                              |
| IaC / deploys                  | **Alchemy** (`2.0.0-beta.79`), `plan` on PR, `deploy` after CI                                                      |
| Toolchain                      | Bun workspaces, Nix flake, `@effect/tsgo`, oxlint, dprint, knip, syncpack, lefthook                                 |
| Architecture                   | **slice × role × concept**, after `beep-effect`                                                                     |
| SQL layer                      | `effect/sql` + `Model`/`VariantSchema`. **No Drizzle, no ORM**                                                      |
| Eval harness                   | TypeScript, Node/Bun only, real Postgres via testcontainers                                                         |
| This plan                      | Lives at `effect-ai/docs/PLAN.md`, committed with the repo                                                          |

### Why not D1 — the correction that drove the data layer

An earlier draft claimed D1 reads are served in-colo. **That is false.** Cloudflare:

> "D1 routes **all queries (both read and write)** to a specific database instance in one location
> in the world, known as the primary database instance."

So D1 is single-region, exactly like Postgres behind Hyperdrive — the supposed advantage did not
exist. Five further findings pointed the same way:

| Finding                                                                | Consequence                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `dutch` is in `pg_ts_config` (verified by query on PG17)               | Snowball Dutch stemming for free. On D1 you hand-roll a stemmer.         |
| Postgres does RRF hybrid search in **one SQL function**                | Transactionally consistent. On CF it is two stores fused in Worker code. |
| pgvector indexes **2,000 dims** (`halfvec` 4,000) vs Vectorize's 1,536 | The embedding-model constraint disappears.                               |
| D1 writes **$1.00/M rows** vs reads **$0.001/M**                       | This product writes provenance rows on every decision.                   |
| `@effect/sql-pg` exposes a public `stream?: () => Duplex`              | Risk drops from "architectural blocker" to "one adapter you own".        |

**And why not Vectorize, now that Postgres is there.** Vectorize's advantage is scale — 20M vectors
per index, managed ANN — which is irrelevant here: a hundred client orgs at 2,000 chunks each is
200,000 vectors, handled by pgvector HNSW on a small instance. What decides it is that **one store
means the vector and the citable text cannot diverge.** Two stores means partial ingest,
`embedded_at IS NULL` handling, a reconciliation query and an ordering rule — a bad failure class
for a product whose claim is that every citation is auditable. One Postgres also gives arbitrary
joins and filters (Vectorize allows ≤10 indexed metadata fields at 64 bytes each), and the eval
harness gets **real** pgvector locally, where Vectorize has no emulator.

Still used, heavily: Workers, Hyperdrive, R2, Queues, KV, Durable Objects, and Workers AI as a
swappable adapter option.

## Stack

| Concern     | Choice                                                                             |
| ----------- | ---------------------------------------------------------------------------------- |
| Core        | the latest `effect@rc`, pinned exactly in the Bun catalog (rc.118 at writing)      |
| Serving     | `HttpApiBuilder.layer` + `HttpRouter.toWebHandler` in the Worker `fetch`           |
| SQL         | `@effect/sql-pg` over Hyperdrive, via a `cloudflare:sockets` `Duplex` adapter      |
| Row schemas | `Model` / `VariantSchema` from `effect/unstable/schema`                            |
| Migrations  | `effect/sql`'s `Migrator`, plain `.sql`                                            |
| Tests       | `@effect/vitest`; `vitest-pool-workers` for real bindings; testcontainers Postgres |

**⚠ Verify subpaths at step 0, not at build time.** rc.118's export map has no `unstable/`
(`./ai ./http ./http-api ./rpc ./sql ./schema …`), but rc.109 and rc.117 have
`effect/unstable/http` and `effect/unstable/httpapi` — the names moved _within_ the RC series, and
`Schema` is a top-level export in rc.117. One command settles it for whatever gets installed; record
it in `docs/effect-v4-api-notes.md` and regenerate on every bump:

```bash
npm view effect@rc version
node -e 'console.log(Object.keys(require("effect/package.json").exports).join("\n"))'
```

Also on the step-0 list: the `Model`/`VariantSchema` import path, and `OpenAiClient`'s `apiUrl`
option (used to point at Mistral).

## Architecture: slice × role × concept

Adopted from [`beep-effect`](https://github.com/beep-effect/beep-effect). Three naming axes plus a
facet suffix:

| Axis                                   | Values here                                                             |
| -------------------------------------- | ----------------------------------------------------------------------- |
| **slice** (bounded context)            | `shared`, `decision`, `policy`, `intake`, `iam`                         |
| **role** (the ring) — one package each | `domain`, `tables`, `use-cases`, `server`, `ui`                         |
| **concept** — one folder each          | `Decision`, `Outcome`, `Rule`, `Execution`, `Chunk`, `Identity`         |
| **facet** — a closed suffix vocabulary | `.model` `.rails` `.table` `.converters` `.errors` `.repository` `.rpc` |

**Roles exist only where a slice needs them** — beep's `documents` has no `client`/`ui`, `shared`
has no `server`. Ceremony scales with the slice.

```
packages/<slice>/<role>/src/<Concept>/<Concept>.<facet>.ts     one facet of a concept
packages/<slice>/<role>/src/<Concept>/<Operation>.ts           one business operation
```

Rings are lowercase, concepts are PascalCase. As built at milestone 4 (see ADR-0010):

```
packages/
  shared/
    domain/      Identity/Identity.model.ts  Identity/Identity.middleware.ts
                 Verbatim/Verbatim.ts        Ids/Ids.ts
    tables/      Database/{Db,Connect,Migrations}.ts   Tenancy/Tenancy.table.ts
    api/         V1/V1.api.ts  V1/Health.wire.ts
  iam/
    domain/      Identity/Identity.wire.ts
    tables/      Session/Session.table.ts               (generated)
    use-cases/   Identity/Identity.rpc.ts
    server/      Session/{Session.betterauth,Session.service,Session.live,Session.http}.ts
  intake/
    domain/      Document/{Document.model,Document.errors,Document.parser,Blobs}.ts
                 Intake/{Intake.model,Intake.wire}.ts
    tables/      Document/Document.table.ts   Intake/Intake.table.ts
    use-cases/   Intake/{IngestUpload,Intake.rpc}.ts
    server/      Document/R2Blobs.ts
  decision/  policy/                                    (steps 5–9)
apps/worker/
  src/Main.ts                the composition root: ports to adapters, nothing else
  src/Health/{GetHealth,Health.rpc}.ts
  src/platform/{Bindings,CloudflareSocket,HyperdriveConnect,Ids,WorkerPlatform}.ts
```

Three places the layout bends, each recorded in **ADR-0010**: `Identity`/`Authenticated` are in
`shared/domain` because every slice's stores carry `CurrentUser` in `R`; `api` is a fourth role
because the versioned wire surface is cross-slice; and exactly two files may name every slice
(`shared/api`, and `Migrations.ts`, because migration order is global).

Package names follow the axes: `@ea/decision-domain`, `@ea/policy-use-cases`, `@ea/iam-server`.

**Why this shape:**

1. **One concept traces across every layer with one grep** — `Decision.model.ts`,
   `Decision.table.ts`, `Decision.repository.ts`, `Decision.rpc.ts`.
2. **The facet suffix is a closed, greppable vocabulary** — `rg --files -g '*.table.ts'` is every
   table; `-g '*.rpc.ts'` every transport surface.
3. **Two naming rules, not one:** `.facet.ts` for facets of a concept, plain `PascalCase.ts` for
   named operations. So `Decision.rpc.ts` beside `ApproveDecision.ts` — use cases keep
   filename == exported symbol, so one grep finds a definition _and_ every call site.
4. **Adapters live inside the slice as its `server` role**, so a slice is whole and `apps/worker`
   is thin: composition root, IaC, frontend.
5. **`tables` vs `server` is load-bearing**: the eval harness needs row schemas and converters,
   never the store — so it depends on `@ea/decision-tables` and not `@ea/decision-server`.

### Encapsulation enforced by resolution

```json
"exports": {
  ".": "./src/index.ts",
  "./*": "./src/*/index.ts",
  "./internal/*": null,
  "./package.json": "./package.json"
}
```

`null` makes a path genuinely unresolvable, so `src/internal/` is truly private. A barrel is correct
as the _curated public surface at a package boundary_ and wrong as internal convenience — the
exports map draws exactly that line. `use-cases` additionally splits `public.ts` (browser-safe) from
`server.ts` (layer wiring), so browser-safety is a file rather than a lint rule.

### Enforcement, on both axes

`workspace:*` deps mean **slice isolation is npm-enforced too**: `@ea/decision-domain` must declare
`@ea/shared-domain`, and cannot reach `@ea/policy-domain` without it appearing in a diff.

```
# dependency-cruiser, tsPreCompilationDeps: true so `import type` counts
**/domain/**       may not import  effect/http, effect/sql, any provider, any */server/*
**/use-cases/**    may not import  any */server/*
apps/worker        the only place that may import a */server/* and a port together
@effect/platform-bun  forbidden in apps/worker and every */server/*  (workerd, not Bun)

grep -c "EmitEvent(new DecisionExecute")   must equal exactly 1
bundle assertion: the browser build must not match /better-auth|node:|pg-/
```

### Two deviations from beep

- **No `aggregates`/`entities`/`values` trichotomy.** Beep is a law-practice knowledge graph with
  RDF and `ontology` packages where DDD's distinctions earn their place. Ours are different — the
  closed `Outcome` enum, the rails, the provenance contract. Keep concept folders; drop the forced
  trichotomy.
- **Fewer packages to start.** Match the _directory shape_ from day one, collapse roles into fewer
  packages until a boundary hurts. Splitting later is `git mv` plus a `package.json`.

Worth stealing: beep scaffolds this with a generator (`beep architecture add concept`). A
`bun scripts/new-concept.ts` is an afternoon and stops the convention drifting.

## Toolchain: Bun monorepo

Ported from `saas-starter`, which already runs exactly this. Root `package.json`:
`"packageManager": "bun@<latest>"`, `"engines": { "bun": ">=<latest>" }`, plus **`.bun-version`**.

| Concern                      | Tool                            | Script                                                                                                           |
| ---------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Package manager + workspaces | Bun, `catalog:` for shared pins | —                                                                                                                |
| Hooks + tsgo patch           | `lefthook`, `@effect/tsgo`      | `prepare: effect-tsgo patch --oxlint && (git rev-parse --git-dir >/dev/null 2>&1 && lefthook install \|\| true)` |
| Format                       | `dprint`                        | `format: dprint fmt`                                                                                             |
| Lint                         | `oxlint` + `oxlint-tsgolint`    | `lint: oxlint --disable-nested-config`                                                                           |
| Typecheck                    | TS 7 (`tsc -b`)                 | `check: tsc -b tsconfig.json`                                                                                    |
| Tests                        | `vitest` + `@effect/vitest`     | `test`                                                                                                           |
| Dead code                    | `knip`                          | `knip`                                                                                                           |
| Dependency drift             | `syncpack`                      | `deps:check: syncpack lint`                                                                                      |
| Secrets                      | `secretlint`                    | `secrets`                                                                                                        |
| Gates                        | —                               | `hygiene: knip && deps:check && secrets`; `preflight: format && check && lint && hygiene && test`                |

`preflight` is what CI runs and what to run before committing.

### Where Bun does and does not reach

**The deployed Worker does not run on Bun — it runs on `workerd`.** So `@effect/platform-bun` /
`BunRuntime` / `BunHttpServer` **must never appear in `apps/worker` or any `*/server/*`**; the
Worker's entry is `export default { fetch, queue, scheduled }` on web-standard APIs. Bun's reach is
the toolchain and everything Node-shaped: `evals/` (`BunRuntime.runMain`, `BunFileSystem`),
`scripts/`, codegen, seeding, and the vitest host for the `node` project.

**Verify at step 0:** `vitest-pool-workers` spawns `workerd` and `wrangler`/`alchemy` are
Node-targeted. Default mitigation: **run the `workers` vitest project and every wrangler/alchemy
command under Node, the `node` project under Bun.**

### Nix flake

Modelled on Effect's own (`bun deno nodejs_latest pnpm python3` + `alejandra`), trimmed:

```nix
{
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  outputs = {nixpkgs, ...}: let
    forAllSystems = f: nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed
      (system: f nixpkgs.legacyPackages.${system});
  in {
    formatter = forAllSystems (pkgs: pkgs.alejandra);
    devShells = forAllSystems (pkgs: {
      default = pkgs.mkShell { packages = with pkgs; [ bun nodejs_22 python3 ]; };
    });
  };
}
```

`.envrc` is `use flake`. **`wrangler` stays out of Nix**: `pkgs.wrangler` lags Cloudflare's weekly
releases, and `workerd` has no standalone nixpkgs derivation, with a history of broken binaries
under Nix's sandboxed linking. Let Nix provide runtimes; let `wrangler` come from
`devDependencies` so the matching prebuilt `workerd` is fetched for your platform.

### tsgo — what it actually is

**TypeScript 7.0 went GA on 8 July 2026 and _is_ the native Go compiler, mainlined.** So `tsc -b`
is already the fast one — Effect's own scripts are plain `tsc -b`. `@effect/tsgo` is Effect's
**language service**: a superset with an embedded `tsgo` plus ~80 Effect-aware rules
(`floatingEffect`, `missingEffectContext`, `outdatedApi`). Wired via `effect-tsgo patch` in
`prepare` and the `@effect/language-service` plugin in `tsconfig.base.json`, plus
`npx @effect/tsgo diagnostics` in CI.

**Hard limitation that dictates a CI decision: TS7 has no stable programmatic API until 7.1.** So
`typescript-eslint`, `ts-morph` and notably **Vitest's `--typecheck`** cannot run on it. Effect
keeps `check` (`tsc -b`) a separate CI job from `test`. **Do the same; never wire typecheck into
Vitest or `vitest-pool-workers`.**

### tsconfig

From Effect's `tsconfig.base.json`: `target ES2022`, `module NodeNext`, `composite` + `incremental`,
`verbatimModuleSyntax`, `erasableSyntaxOnly` (relaxed in the tests config),
`exactOptionalPropertyTypes`, `noUnusedLocals`/`Parameters`, `strict`, `types: []`, **no `lib`
override**, **no `noUncheckedIndexedAccess`**.

**`apps/worker` carries two tsconfigs.** `@cloudflare/workers-types`' `Request`/`Response` collide
with `lib.dom.d.ts`, so `tsconfig.worker.json` (workers-types, no DOM) and `tsconfig.web.json` (DOM,
no workers-types) are referenced separately from the app root. Because the base sets `types: []`,
the Worker config must **explicitly** list `"types": ["./worker-configuration.d.ts"]` — it is not
picked up by `include`. Add `worker-configuration.d.ts` and `.wrangler/` to dprint's `excludes` and
oxlint's `ignorePatterns`.

### Alchemy for IaC and CI/CD

TypeScript-native IaC: infrastructure and application code in one program wired by typed bindings,
applied with `bun alchemy deploy`. Covers Workers, Hyperdrive, R2, KV, Queues, Durable Objects,
Containers, Cron. One language from the infrastructure declaration through the Worker to the
browser, with bindings typed rather than hand-transcribed into `wrangler.jsonc`.

It is `alchemy-run/alchemy` by Sam Goodwin, Apache-2.0 — **not** an Anthropic project, despite one
page summary claiming so. **`2.0.0-beta.79`, pre-1.0**, which is a different risk class from a
pre-1.0 library: a bad state transition costs a deploy, not a compile. Accepted, with ordinary
mitigations: pin exactly, commit state, `alchemy plan` on PRs and `deploy` only after CI passes
(the shape `saas-starter`'s `deploy.yml` already has), and keep `wrangler` usable as a fallback for
the Worker so you are never blocked.

## Repo layout

Bun workspaces. The deciding argument is that **a package boundary turns browser-safety and slice
isolation from checks into facts** — a package whose dependency is `{ "effect": "catalog:" }` cannot
reach `pg` code, because it is not in its module graph. Secondary: the eval harness runs in Node/Bun
against the same domain and table code.

```
effect-ai/
  flake.nix  .envrc  .bun-version
  package.json  bunfig.toml        workspaces + catalog: the exact pinned effect RC
  tsconfig.base.json
  dprint.json  .oxlintrc.json  knip.jsonc  lefthook.yml  .syncpackrc.json
  vendor/effect/                   submodule, --depth 1, READ-ONLY reference
  vendor/effect-form/              submodule (separate repo; see below)
  docs/
    PLAN.md                        ← this plan
    effect-v4-api-notes.md         verified subpaths at the pinned version
    runbooks/{UpgradeEffect,ReEmbed,ProviderProfiles}.md
    adr/                           0001 … 0008
  packages/
    shared/domain/
    decision/{domain,tables,use-cases,server}/
    policy/{domain,tables,use-cases,server}/
    intake/{domain,tables,use-cases,server}/
    iam/{domain,tables,use-cases,server}/
    testkit/
  evals/                           Node/Bun only. Never on Workers.
  apps/worker/
    alchemy.run.ts                 IaC: Worker, Hyperdrive, R2, KV, Queues, DOs, Cron
    wrangler.jsonc                 fallback / local dev
    vite.config.ts                 @cloudflare/vite-plugin + tanstackStart
    tsconfig.worker.json  tsconfig.web.json
    migrations/                    effect/sql Migrator — authoritative for EVERY table
    src/Main.ts                    the composition root
    src/web/                       TanStack Start — the reference client
```

### Vendored reference source

- **`@effect/atom-react` needs no separate submodule** — it resolves to `Effect-TS/effect`
  (`packages/atom/*`) on the same RC tag, so `vendor/effect` already covers it.
- **`@lucas-barake/effect-form` / `-react` do** — a separate repo. They are on `0.25.0`/`0.26.0`
  with no `rc.118` tag, so they version independently and can lag v4. Pin them; treat a bump as its
  own verification step.
- Submodules are pinned `--depth 1` to the sha matching the installed version, recorded in
  `vendor/EFFECT_PIN`; excluded from tsconfig, vitest, lint and build; `AGENTS.md` states read-only,
  never import. A CI check asserts the submodule version equals the lockfile's.

## Data layer: PlanetScale Postgres via Hyperdrive

Created from the Cloudflare dashboard or Wrangler; _"you will see a line item on your Cloudflare
invoice for your PlanetScale usage"_, and Cloudflare credits apply. Hyperdrive establishes
connections in _"single digit milliseconds (p90 4 ms)"_. pgvector **0.8.5** and `pgvectorscale` are
available; 32 native and 19 community extensions.

**The floor:** _"a PlanetScale database is billed daily from when the database is created until the
database is deleted."_ Not scale-to-zero. Accepted.

### Milestone 0: the `cloudflare:sockets` adapter

`@effect/sql-pg` v4 has **zero runtime dependencies** and implements the Postgres wire protocol
itself, dialling with `node:net` / `node:tls` directly. Workerd supports both (`net.Socket`,
`net.connect`, and — importantly — it always opens sockets in `starttls` mode, exactly what
Postgres's SSLRequest upgrade needs). But **no vendor or library claims Workers support**, so it is
unverified by execution.

The mitigation is first-class, not a hack: `PgClientConfig` exposes a public `stream?: () => Duplex`,
which bypasses `Net.connect` entirely.

```ts
// packages/shared/.../CloudflareSocket.ts
// Wrap connect() from cloudflare:sockets in a Duplex and hand it to PgClient.
PgClient.layer({ stream: () => cloudflareDuplex(env.HYPERDRIVE) })
```

**Milestone 0 proves or kills this in about a day**: `SELECT 1` through Hyperdrive in real
`workerd`, then SCRAM-SHA-256 auth, prepared statements, a `to_tsvector('dutch')` query and an HNSW
query. Known sharp edges: `rejectUnauthorized: false` **throws** in workerd's TLS wrapper
(unnecessary through Hyperdrive); `key`/`cert` are silently ignored
([workerd#7201](https://github.com/cloudflare/workerd/issues/7201), open), breaking mTLS only;
`SCRAM-SHA-256-PLUS` channel binding is not implemented. Six simultaneous outgoing connections per
invocation.

### Hyperdrive caching — a real gotcha

Caching is **on by default**, `max_age` 60 s, `stale_while_revalidate` 15 s, configured
**per-Hyperdrive-config, not per query**. And: _"Hyperdrive does not invalidate cached read query
results when your application writes to your database."_

A reviewer who approves a decision and sees a 60-second-stale queue is a bug. So: **two Hyperdrive
bindings to the same database** — one cached (policy corpus reads, effectively static) and one
`--caching-disabled` (the queue, decision detail, everything transactional). The documented pattern;
watch the ~100-connection cap across configs.

Also: `@effect/sql-pg` caches prepared statements by name by default. Fine with Hyperdrive on the
**Direct** connection string (which Cloudflare recommends over a provider's pooled string). If ever
placed behind a transaction-mode pooler, set `prepare: false`.

### The SQL layer: no ORM, no Drizzle

- **Queries**: `effect/sql`'s `SqlClient` with tagged templates — parameterised, no query builder.
- **Row schemas**: `Model` / `VariantSchema` — `Model.Class` defines a row once and derives
  select/insert/update variants. Being an `effect/schema` type, it composes with the domain schemas
  and the `HttpApi` contract instead of being a parallel inferred type system.
- **Typed queries**: `SqlSchema` helpers, schema-validated in and out.
- **Migrations**: `effect/sql`'s `Migrator` over plain `.sql`, authoritative for every table
  including better-auth's.

So `tables` holds `Decision.model.ts`, `Decision.converters.ts`, and the migration.

## Schema, RLS, and the org seam

Postgres, so: real transactions, `timestamptz`, `jsonb`, and **RLS**. Money is **integer minor
units** in `integer`/`bigint` columns — never `real`/`double`.

Core tables: `organization`, `member`, `user`, `session` (better-auth's, generated then committed as
a migration), plus `member_authority` (approval limits — ours, a side table so regenerating
better-auth's schema cannot clobber it), `source_documents`, `document_chunks`, `intakes`,
`extractions`, `document_fingerprints`, `decisions`, `decision_citations`, `rules`, `executions`,
`events`, and the workflow tables (`workflow_executions`, `workflow_activities`).

Load-bearing choices:

- `decisions.decide_key UNIQUE` — a redelivered decide message cannot produce a second decision, and
  short-circuits **before any model call**. docket has this hole; Queues' at-least-once delivery
  would widen it.
- `decisions` has **no `executed` status**; execution state lives in `executions` and is joined.
- `effective_outcome` is generated (`coalesce(override_outcome, outcome)`) so a caller cannot read
  `outcome` as final by accident.
- `retrieval_mode` is recorded — a decision made on degraded retrieval is not the same decision.
- A partial unique index allows **at most one armed auto-approve rule per org per vertical**; docket
  silently picked the newest of several.
- `document_fingerprints` turns docket's SELECT-then-decide duplicate check into a constraint.
- `intakes.external_ref` is unique **per org**; docket made it global, leaking one tenant's refs into
  another's errors.

### The org seam, now with RLS as the second net

Two layers, because only one is checkable by `tsc`:

**1. The requirement is in the type.** `CurrentUser` is a `Context.Service` with no default, and
**every store method carries it in `R`**. There is no overload taking an `orgId` — if a caller can
name a tenant, the seam has failed. The queue consumer, which has no session, gets a deliberately
_different_ tag (`CurrentOrg`) provided from the event payload, so a request handler cannot satisfy
`CurrentUser` with a worker-shaped identity and an audit can grep every non-interactive scope.

**2. RLS enforces it in the database.** `Db.scoped` opens a transaction and runs
`select set_config('app.current_org', $orgId, true)`, and RLS policies do the rest — docket/web's
pattern, which D1 could not support. The app-layer filter stays as defence in depth: _"neither is
trusted alone."_

```ts
export interface DbService {
  readonly scoped: <A, E>(f: (sql: SqlClient, orgId: OrgId) => Effect<A, E>) => Effect<A, E | SqlError, CurrentUser>
  readonly transaction: <A, E>(
    f: (sql: SqlClient, orgId: OrgId) => Effect<A, E>
  ) => Effect<A, E | SqlError, CurrentUser>
  /** Deliberately conspicuous. For session lookup, where "which org" is the ANSWER. */
  readonly unscopedForAuth: <A, E>(f: (sql: SqlClient) => Effect<A, E>) => Effect<A, E | SqlError>
}
```

Plus the mechanical test RLS does not replace, because a policy can be missing:

```ts
// The key type is `keyof DecisionStoreService`, so adding a method without a
// cross-tenant case here FAILS TO COMPILE.
const cases: { readonly [K in keyof DecisionStoreService]: TenancyCase } = { … }
```

Run for **every** store against real Postgres with two seeded orgs, as org A against org B's rows.

### Idempotency

With real transactions this is ordinary, but keep the strongest primitive anyway: a single statement
that claims and reports.

```sql
INSERT INTO executions (…, idempotency_key, status) VALUES (…, 'pending', …)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```

Zero rows → someone else owns it. Keys are **derived, never generated**:
`decision:<decisionId>:<action>` is used for **both** the `events` row and the `executions` row, so a
retry at either layer lands on the same key.

**The one failure mode that remains, and it can pay a supplier twice:** the adapter call succeeds and
the recording write is lost. No transaction helps — the outbound call is outside any database. Fixes,
in order: **(a)** `AdapterRequest` carries `idempotencyKey` and passes it as the _provider's_ dedupe
header, which is why the field belongs in the interface on day one even though `DryRunAdapter`
ignores it; **(b)** never auto-retry an ambiguous `pending` — ack, mark the decision
`needs_attention`; **(c)** a cron **reports** stuck claims to an operator view and must not resolve
them. Also: `Adapter` gets an optional `lookup?: (key) => Effect<Option<Response>>` so reconciliation
can ask the target system what actually happened. **ADR: an adapter without provider-side idempotency
may not be enabled for a customer with auto-approve armed** — a product rule, not an engineering one.

## Hybrid retrieval in one query

pgvector + `tsvector`, fused by RRF **in SQL**, transactionally consistent, with the org filter and
`collection` separation in the same `WHERE`.

```sql
-- policy/tables/…/HybridSearch.sql  (a function; RRF over two CTEs)
-- semantic:  embedding <=> $query_embedding      (HNSW, cosine)
-- lexical:   ts_rank_cd(tsv, websearch_to_tsquery('dutch', $q))
-- fused:     coalesce(1.0/($k + s.rank), 0) * $w_sem
--          + coalesce(1.0/($k + l.rank), 0) * $w_lex
```

What this kills compared with the two-store design: **Dutch stemming is free** (`to_tsvector('dutch',
…)`, Snowball — `dutch` verified present in `pg_ts_config`); no 100-bound-parameter hydration cap; no
namespace tenant ceiling; no 1,536-dimension cap; no "vector store and text store disagree"; and
**local dev plus the eval harness get real pgvector**.

`collection` separation (`policy` vs `transactional`) stays a `CHECK`-constrained column with the
filter inside the retrieval function — and the function is the only way to query the corpus, so it
cannot be forgotten. Both halves are one round trip, so there is no partial-failure degradation mode;
if the embedding provider is down, ingestion stalls rather than retrieval silently degrading, which
is the better failure.

**Still port docket's obligations index (slice 1.5).** Obligations are indexed once at ingest,
applicable ones computed _in code_ from extracted fields, then fetched **by id**, bypassing ranking;
ranked retrieval only adds context. This is what lets the product say "these rules applied and every
one was considered." `clause_ref` and `in_force` exist so it lands without a rewrite.

## The `env` → Layer composition root

`HttpEffect.toWebHandlerLayerWith` settles the shape: the layer is built **exactly once, lazily, on
the first request**, cached in a module closure for the isolate's life; per-request cost is a few
`Context.add` calls. Its second parameter is typed `Context<ReqR>` where
`ReqR = Exclude<R, Provided | Scope | HttpServerRequest>` — so anything the app needs that the layer
does not provide is a **compile error** unless passed per request. That is the door.

```ts
/** A Service, deliberately NOT a Reference: a default value for "the database"
 *  is a bug that compiles. Forgetting to provide this must not type-check. */
export class Bindings extends Context.Service<Bindings, Env>()("app/Bindings") {}
/** Genuinely per-invocation. NEVER cached, NEVER inside a memoised layer. */
export class RequestCtx extends Context.Service<RequestCtx, ExecutionContext>()("app/RequestCtx") {}

const AppLayer = (env: Env) =>
  Routes.pipe(
    Layer.provide(Services),
    Layer.provide(Infra),
    Layer.provide(Platform),
    Layer.provide(Layer.succeed(Bindings)(env)) // env enters here, once
  )
const memoMap = Layer.makeMemoMapUnsafe() // fetch/queue/scheduled share one graph
let app: App | undefined
export const getApp = (env: Env) => (app ??= makeApp(env, memoMap))

export default {
  fetch: (req, env, ctx) => getApp(env).handler(req, Context.make(RequestCtx, ctx)),
  queue: (batch, env, ctx) =>
    getApp(env).runtime.runPromise(
      consumeBatch(batch).pipe(Effect.provideService(RequestCtx, ctx))
    ),
  scheduled: (_, env, ctx) =>
    getApp(env).runtime.runPromise(
      ReconcileStuckExecutions.pipe(Effect.provideService(RequestCtx, ctx))
    )
} satisfies ExportedHandler<Env>
```

Built once per isolate: every layer, the router trie, the Hyperdrive-backed `PgClient` and its
prepared-statement cache, the better-auth instance. Memoise the client on the binding identity via a
`WeakMap`, never per request. Caching the binding object is correct for Hyperdrive/R2/KV/queue
producers, vars and secrets — **not** for `ExecutionContext`, which is why `RequestCtx` is separate.

**One Worker, not an auxiliary one**: one layer graph, one authorization seam greppable in one
package, one `waitUntil` budget, and assets served before the Worker runs. **CORS is deleted** for
the first-party path — no trusted-origins list, no cookie domain, the three settings most likely to
be subtly wrong. CSRF protection stays on, and the `HttpApi` contract requires
`content-type: application/json` by construction.

**No `AsyncLocalStorage` anywhere.** Effect's fiber carries the context; request-scoped services
arrive via the handler's second argument or `HttpApiMiddleware`. (Workerd does not implement
`enterWith()`, so this is a reason the design is right rather than a constraint on it.)

## Durable execution: `effect/workflow` yes, `effect/cluster` no

**Why cluster is out, measured:** `SqlMessageStorage` calls `sql.withTransaction` in **nine** places,
six read-then-write, and on SQLite there is no `FOR UPDATE` so the transaction is the only thing
making message-claiming non-racy. Sharding runs 3 s / 10 s / 35 s / 60 s background loops assuming
long-lived processes. **No Durable Object runner exists** — only `HttpRunner`, `SocketRunner`,
`SingleRunner` (Node-shaped), `TestRunner` — and `SingleRunner` does not skip sharding, it only drops
runner-to-runner RPC and health checks. Bridging it is **2–4 weeks of framework infrastructure**;
cluster's design centre is _N long-lived processes over a shared transactional database_, a DO is
_one single-threaded actor with private storage_. Different shapes.

**Why workflow is in:** `Workflow.execute`, `Activity` and `DurableDeferred` require **only
`WorkflowEngine`**; nothing under `workflow/` imports `cluster`. `ClusterWorkflowEngine` is one
implementation of a **10-method interface**, and Effect _exports helpers for writing another_ —
`WorkflowEngine.makeUnsafe`, `WorkflowEngine.makeDeferredState`. `Activity.ts` has **zero**
persistence logic; the memo lives entirely behind `engine.activityExecute`.

**The prize is retry economics, not suspend.** The decide pipeline is extract → retrieve → decide →
judge. Today a transient judge failure makes Queues redeliver and re-run everything, including a
~€0.05 extraction. With durable activities each completed step replays from its stored exit.

**Plan: a ~200-line Postgres-backed engine, memoisation only.** `activityExecute` is ~20 lines:
`SELECT exit_json` on `(execution_id, name, attempt)`; hit → return; miss → run
`activity.executeEncoded` under `Workflow.intoResult`, `INSERT`, return. Plus `execute` (persist
payload, run, store the `Workflow.Result`), `poll`, `register`. `deferredResult` stubs to
`Option.none()`, `scheduleClock`/`interrupt*` to `Effect.void`/`Effect.die`. **150–250 lines, 1–2
days including tests.** With real transactions the memo claim is genuinely atomic — better than the
D1 variant would have been.

Constraints: **no `DurableDeferred` and no `DurableClock.sleep` over 60 s in a workflow body** (with
`deferredResult` stubbed, `await` suspends forever; ≤60 s sleeps route through an in-memory
`Activity`) — enforce by lint. Port the `execute` suspension discrimination verbatim: getting it
wrong means workflows that hang or double-run.

**The human pause stays a database row.** docket's §6 argument, plus two more: waking a suspended
execution needs a live runner running a poll loop — **nothing self-schedules** — and a
`DurableDeferred` token is **unsigned base64url of `[workflowName, executionId, deferredName]`**,
i.e. a forgeable capability to authorise a payment.

For completeness: **Cloudflare Workflows** duplicates much of this and beats it on suspend
(`step.do()` memoises, `waitForEvent` spans 1 s–365 days with buffered events, retention built in).
It is the right tool if durable suspend becomes a requirement. It is not the pick now because a
Workflow body must be a `WorkflowEntrypoint` class whose `run(event, step)` is async — so Effect runs
_inside_ steps rather than _being_ the workflow, inverting the goal. **ADR-0003** records the
trigger: if approval chains ever need to be genuinely multi-step and durable, revisit.

## The event engine on Queues

Queues replaces most of docket's machinery. **Delete** `max_attempts` (Queues owns `max_retries`) and
**delete `sweep_stale_events`** — an invocation that dies without `ack()` is redelivered, so there is
no stuck-in-processing state to sweep.

What still needs a row: **audit** (Queues has no queryable history — the product's own thesis applied
to its machinery), **idempotency** (`events.idempotency_key UNIQUE`; Queues has no dedupe), and
**correlation** (the `event_id` on every span and log line).

The **enqueue gap** is the one genuine sweeper: no transaction spans the row insert and `queue.send`,
so a `queued` row older than two minutes is the recovery record and a cron re-sends.
`ReconcileStuckExecutions` also re-emits for `approved` decisions with no `executions` row — the
outbox pattern with a cron instead of a transaction, safe only because the execute path is idempotent
by key.

One queue carrying a tagged union (`document.decide` | `decision.execute`), `max_retries: 5`,
`max_batch_size: 10`, a DLQ whose consumer writes `events.status = 'dead'` so a dead letter is
visible in the product rather than only in a dashboard. Message bodies are tiny —
`{ eventId, type }` — so the row is the source of truth and a redelivery reads _current_ state.

The consumer acks/retries **per message** — never `ackAll`/`retryAll`, or one poison message re-runs
nine healthy ones — and classifies errors: `DocumentNotFound`, `UnknownVertical`, `RailsRefused` are
**terminal** (ack, record, stop; they fail identically on retry — docket burned three model calls on
every deterministic bug); defects and transport errors retry with backoff.

### No Redis — where its four jobs go

| Redis did                  | Replacement                                                            |
| -------------------------- | ---------------------------------------------------------------------- |
| Celery broker              | **Queues** — managed retries, DLQ                                      |
| Session + permission cache | **KV** — eventually consistent is correct here                         |
| Idempotency locks          | **`UNIQUE` + CAS in Postgres** — durable and auditable, not a TTL lock |
| Rate limiting              | **three different answers** ↓                                          |

Cloudflare's rate-limit binding is GA and free but _"there is a unique limit per Cloudflare
location"_ and _"permissive, eventually consistent, and intentionally designed to not be used as an
accurate accounting system"_, with periods restricted to 10 s or 60 s. So:

- **Coarse flood protection** → the binding, plus zone-level WAF rules that fire before the Worker.
- **Per-API-key quota** (a customer's contractual "1,000/hour") → **a Durable Object per key.**
  Accounting, which the binding is explicitly not for, and 10/60 s cannot express an hourly window.
  A DO is single-threaded so the count is exact without locks, with an alarm to reset. **This is the
  one place a Durable Object genuinely earns its keep.**
- **OTP / sign-in attempts** → **neither.** Per-colo is unsafe: 5 attempts per colo across ~300
  colos is ~1,500 guesses at a 6-digit code. Attempt counts belong on the verification row in
  Postgres, where better-auth already keeps them.

Caching needs less than the Redis instinct suggests: KV for sessions and org config,
`caches.default` for HTTP responses, per-isolate memory for the `PgClient`, and Hyperdrive's own
cache for the static policy corpus. `effect/persistence` ships a `RateLimiter` with a pluggable
store, so a DO-backed store adapter keeps the quota logic testable against a fake.

## AI providers: two profiles, chosen per client

The ports (`LanguageModel`, `Embedder`, `DocumentParser`) never change. The _profile_ does.

| Profile          | Use                         | Notes                                                                                                                                                         |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`openrouter`** | development, non-EU clients | `@effect/ai-openrouter` at the pinned RC; model-agnostic, one key; embeddings via OpenRouter's OpenAI-shaped `/v1/embeddings` (34 models incl. `baai/bge-m3`) |
| **`mistral-eu`** | **EU / Dutch clients**      | **Direct** to Mistral — French company, EU jurisdiction, processing in EU data centres, DPA available                                                         |

**The nuance that makes this two profiles rather than one: OpenRouter is a US intermediary.**
Routing Mistral _through_ OpenRouter means the request transits a US company, defeating the
residency argument. EU clients need the direct client.

Mistral covers all three capabilities from one EU vendor:

| Capability | Model                           | Note                                                    |
| ---------- | ------------------------------- | ------------------------------------------------------- |
| LLM        | `mistral-large` etc.            | extraction, decision, judge                             |
| Embeddings | `mistral-embed`, **1024 dims**  | competitive with `text-embedding-3-large`               |
| **OCR**    | Mistral OCR 4.1, GA 31 Aug 2026 | **$4 / 1,000 pages, bounding boxes + block confidence** |

**Zero Data Retention is available on the Scale plan for stateless calls only** — chat completions,
embeddings, moderation, OCR, audio — and **not** for stateful products (agents, batch, conversations,
libraries, Le Chat). **The adapter must use stateless endpoints only**; write that into the code, not
a footnote. There is **no `@effect/ai-mistral`**, but Mistral's API is OpenAI-compatible, so
`OpenAiClient` with `apiUrl` is the path (verify at step 0).

**Embedding swaps are a data migration, LLM swaps are a config string.** Different models occupy
different vector spaces, so the pgvector column dimension and the HNSW index are tied to the model.
`Embedder` exposes `modelId` and `dimensions`; `document_chunks` carries `embedding_model` and a
**nullable** `embedded_at` so a swap degrades a chunk to lexical-only rather than destroying the
audit trail. `docs/runbooks/ReEmbed.md` is written before it is needed.

## Document parsing: three tiers, one port

| Input                          | Adapter                                                                       | Slice   |
| ------------------------------ | ----------------------------------------------------------------------------- | ------- |
| `.md` / `.txt`                 | native, in-Worker, free                                                       | **1**   |
| Office formats, text-layer PDF | **Firecrawl `anydoc` WASM** — MIT Rust, 14 formats, ~4.7 ms median, in-Worker | **1.5** |
| **Scanned / photographed PDF** | **Mistral OCR** — EU, bounding boxes, block confidence                        | **2**   |
| anything else                  | a typed `UnsupportedDocument` failure, never a best-effort parse              | —       |

The Rust question resolved itself: `anydoc` already ships a WebAssembly build, which is the only
version worth having (as a separate service it has the same hosting cost as the existing Python one
while parsing worse). Verify at 1.5 that the WASM module initialises under `workerd`; the 64 MiB
bundle limit makes size a non-issue.

**Mistral OCR's bounding boxes are better than expected for this product**: they let the reviewer UI
show _where on the page_ a `source_span` came from, which a text-layer parser cannot. And block
confidence is a natural rail-2 input — a low-confidence block is a reason to force review.

**A parser version defines the verbatim contract.** Its markdown output is what `source_span` is
checked against, so a parser bump changes spans → changes `containsVerbatim` → changes grounding,
silently. Pin exactly; treat a bump like an Effect bump, with an eval re-run in the runbook.

## API-first: the product is the API

Driven by a real second consumer — a PHP/Laravel internal tool that wants AI functionality.

1. **A versioned public `HttpApi` with OpenAPI + Scalar docs**, derived from the same declaration
   that types the handlers, so docs cannot drift.
2. **A frozen wire schema separate from the domain** — `api/v1/Wire.ts` holds versioned snake_case
   classes hand-mapped from domain types; no domain type is re-exported, however convenient. So a
   domain rename cannot break a v1 client you do not control.
3. **Two authentication paths, one `Identity`.** `X-API-Key` (SHA-256 hashed, shown once) resolves to
   the _same_ `CurrentUser` as the cookie. CORS returns for the API-key path only.
4. **Async semantics a third party can consume.** `POST /api/v1/intakes` returns **202** with an
   intake id; the caller polls `GET /api/v1/decisions?intake_id=…` (slice 1) or receives an
   HMAC-signed **webhook** (slice 1.5, outbox + retries).
5. **The reference UI consumes only the public API** — deliberately reversing the in-process-SSR
   optimisation, because dogfooding surfaces every gap the moment the UI needs something. The
   in-process path stays available behind `ServerBridge.ts`, unused in slice 1.

Transports are additive by construction, which is exactly the property being cashed in.

## Service design

### Rails are a pure branded function, not a service

```ts
declare const RailedBrand: unique symbol
export interface RailedDecision {
  readonly [RailedBrand]: never /* … */
}
export const applyRails: (input: RailInput) => RailedDecision
```

`DecisionStore.settle` accepts **only** a `RailedDecision`, and the brand is unconstructible outside
`Decision.rails.ts`. **A decision cannot be written without having passed the rails, and it is a
compile error to try.** That is why rails are not a service — "the rails, but disabled" must not be
expressible. docket's rails are a function too, but nothing stops a caller inserting a `Decision`
row directly; the brand closes that.

Property test (`fast-check`): for all inputs,
`severity(output) >= severity(proposal)` under
`auto_approve < route_for_approval < {reject, needs_human}` — the machine-checkable statement of
"rails only ever move a decision toward a human", needing no database, model or bindings.

**The four rails.** Docket's three, plus one addition admissible because it can only move a decision
toward a human: (1) failed grounding → `needs_human`; (2) any non-verbatim `source_span` forces
review; (3) `auto_approve` gated by an explicit stored rule, never model confidence — _"a model's
own confidence score is not an authorisation"_; (4) `auto_approve` additionally requires
`retrieval_mode = 'hybrid'`, because _"degraded retrieval that nobody can see is exactly the failure
this codebase keeps running into."_

### Shared with the frontend

`@ea/shared-domain` and each slice's `domain` export `Outcome`, `DecisionSummary`/`Detail`,
`Citation`, `ExtractedField`, `Identity`, every `Schema.TaggedError`, and the `HttpApi` contract — so
the client is `HttpApiClient.make(ApiV1, { baseUrl: "" })`, decoded by the same schema the handler
encoded with. **`containsVerbatim` is shared too**: the reviewer UI highlights a span using the same
function that decided whether it verified, so the highlight cannot disagree with the rail.

## Extraction and the verbatim check

`ExtractedField(T)` = `{ value, source_span, page }` (+ `bbox` once OCR lands).

**Money is extracted as `String`, not `Number`** — the digits exactly as printed, which is also what
`source_span` quotes. `Money.parseMoney` converts to integer minor units and **fails** on ambiguity
(`1.234` in a document that elsewhere shows `1,234.56`; >2 decimals). A parse failure is a
`checkFailure`, forcing review — an amount we cannot read exactly is not one we should decide on.
Coerce to `Number` instead and `1.234,56` silently becomes `1.234`: a wrong decision with a perfect
audit trail. `currency` is declared **before** any amount, on the same logic as below. `Money` is
`{ minor: Cents, currency }` and refuses to add across currencies.

**Field order is load-bearing and measured.** `ProposedDecision` declares
`outcome, citations, rationale, …` — **citations before rationale**. docket's note is precise: the
other way round _"accounted for 25 of 66 grounding failures on a 99-case run"_, because the model
writes `[7]` mid-paragraph and only afterwards works out what citation 7 was. `source_span` before
`value` follows the same logic but is a **hypothesis, not a measurement** — make it the harness's
first A/B and record the result in an ADR.

`generateObject` is **native JSON mode**, not a forced tool call: it sets
`responseFormat: { type: "json", objectName, schema }` with `toolChoice: "none"`, then decodes the
concatenated _text_ parts. Retry only `InvalidOutputError` and transport errors, never a decode
failure that fails identically.

```ts
/** Whitespace-normalised, case-folded: a model that re-wraps a line has not
 *  invented anything. Nothing else is normalised — punctuation, digits and
 *  currency symbols must match, because those are worth lying about. */
export const normalize = (t: string) => t.split(/\s+/).filter(Boolean).join(" ").toLowerCase()
export const containsVerbatim = (excerpt: string, source: string) => {
  const n = normalize(excerpt)
  return n.length > 0 && normalize(source).includes(n) // empty quotes nothing
}
```

Walking the decoded value for spans is the one place TS is weaker than Python's `isinstance`. Use a
**structural predicate** (`source_span: string` + `page` + `value`, no other keys), cross-checked by
**a declared path list per vertical asserted in a test** — that second check catches "somebody added
a field and the walker silently skipped it", the failure that matters because an unchecked field
looks identical to a passing one. Do not plan on deriving paths from the schema AST.

Arithmetic is integer-only: `quantity_milli × unit_price_cents / 1000` with explicit rounding, VAT
compared in integer per-mille against `[0, 90, 210]`. **No float touches money**; lint-ban
`Number(x) * 100`. A failure is never a rejection — it sends the case to a human with the failing sum
named.

## Testing

| Tier         | Runner                                                         | Needs                                                                           |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Domain**   | `@effect/vitest`, node                                         | nothing. Rails, verbatim, arithmetic, money, RRF                                |
| **Use case** | `@effect/vitest`, node                                         | nothing — fakes + `ScriptedLanguageModel`. No key, no DB, no network            |
| **Adapter**  | `vitest-pool-workers` (real workerd) + testcontainers Postgres | RLS, migrations, the `ON CONFLICT` claim under concurrency, the sockets adapter |
| **Eval**     | plain node/bun                                                 | fixtures only                                                                   |

Tier 2 is where most value is, and it exists _only because_ the ports have no `SqlClient` in them.

**The scripted model ships in `server/`, not a test folder** — `wrangler dev` with no API key should
run the whole pipeline. It's three lines, because structured output is JSON-in-text:

```ts
export const layerScripted = (script: Script) =>
  Layer.effect(LanguageModel.LanguageModel)(LanguageModel.make({
    generateText: (options) => Effect.succeed([{ type: "text", text: script.respond(options) }]),
    streamText: () => Stream.empty
  }))
```

It **dies on a script miss** rather than falling back — a test that silently gets a default answer
passes for the wrong reason. Then a library of **adversarial scripts, which are the product rather
than incidental tests**: a span not in the document → rail 2; totals that don't add up → never
automatic; VAT 13% → never automatic; a `[7]` marker with no citation 7 → `needs_human`; a citation
to a clause never retrieved → `needs_human`; an excerpt from clause 3 attributed to clause 5 →
`needs_human`; clean + no armed rule → `route_for_approval`; clean + armed rule that fails →
`route_for_approval`; clean + armed + degraded retrieval → held; clean + armed + hybrid →
`auto_approve` **and `decision.execute` emitted from the router**. That last row guards the central
architectural claim, paired with the `grep -c` test asserting exactly one emit call site.

**`evals/` runs the real stores and the real rails** against testcontainers Postgres — the same
engine as production, not merely the same dialect, which is a fidelity gain over the D1 plan. Scores
against docket's recorded baseline of **33/99 grounded, 7/99 matched**, the harness's first printed
line.

**`CheckRule.ts` is the CI gate**, ported from docket's `check_rule.py`: _if the model proposed
`auto_approve` for every invoice, what would still stop it?_ Grounding is pinned `true` and retrieval
`hybrid` on purpose — the model and retrieval get **no credit**, only code may stop it. No model, no
database, no network; milliseconds. **Gate: every `nasty`-labelled case must be stopped, and the
report names the rail.** Also print the false-positive side — a rule that stops everything passes the
gate and is worthless.

## Real-world fit: client work

The concrete case: a Dutch SME/industrial prospect with a Laravel internal tool.

**Two client-blocking items, both now addressed.** **EU data residency** — solved by the `mistral-eu`
profile, with the allowed-provider set as per-client configuration and a recorded decision rather
than a default, plus a DPA and ZDR on Scale. **Scanned PDFs** — solved by Mistral OCR at slice 2; the
typed refusal was right as _behaviour_ but wrong as _scope_, because real SME invoices are frequently
scans and "we cannot read half your invoices" kills a pilot.

**Where this wins.** The API-first shape makes a Laravel integration a two-day job on their side.
Per-client deploys are trivial and, because org scoping is one seam, switching between shared and
dedicated is one file. And **portability is demonstrable, not promised**: `domain/` and `use-cases/`
import `effect` and nothing else, only `server/` is platform-specific, and the eval harness already
proves it by running the same SQL in Node. Postgres strengthens this considerably over the D1 plan —
_"you could self-host this"_ is now literally true.

**Honest liabilities.** **Workers cannot be self-hosted**, so air-gapped clients are out of scope
(the same domain and use cases run on Node + Postgres — a different deployment, not a rewrite).
**Effect is a small talent pool and v4 RC docs are thin**; price handover into a retainer rather than
discovering it later. **PlanetScale bills daily**, so there is a floor — for a bursty internal tool
that is the main cost argument lost versus the all-Cloudflare variant. And **the escalation rate is
what kills pilots**: a pilot's success criterion is the auto-handle rate, and this architecture's
honest behaviour under poor retrieval is to escalate everything — correct, and indistinguishable
from failure. docket's M3 notes record 3 of 5 seeded invoices landing in `needs_human`.

## Build order

### Preconditions (environment, before milestone 0)

Verified on 2026-09-28: wrangler is installed at `3.109.2` and authenticated as
`ishak@stacklane.co`, account `f4599b98c2430a831bcfc291d156a988`. Two blockers:

1. **Wrangler is three majors behind** (latest `4.143.0`). Not cosmetic: the **Rate Limiting
   binding requires wrangler ≥ 4.36.0**, and the `@cloudflare/vite-plugin` and
   PlanetScale-from-Cloudflare flows assume v4. → upgrade globally _and_ pin in
   `devDependencies`.
2. **The OAuth token's scopes are too narrow.** Current:
   `user(read) · offline_access · account(read) · workers(write) · workers_kv(write)`.
   **No D1, R2, Queues, Hyperdrive or Durable Objects scopes** — so provisioning would fail with
   a 403 partway through. → `wrangler logout && wrangler login` (**interactive; the user must
   complete the browser OAuth**) and confirm the new scope list before provisioning anything.

Also available but **not connected in-session**: the Cloudflare plugin at
`~/.claude/plugins/cache/cloudflare/cloudflare/1.0.0` declares an MCP server
(`https://mcp.cloudflare.com/mcp`) and ships 13 skills — `wrangler`,
`workers-best-practices`, `durable-objects`, `agents-sdk`, `web-perf` and others, plus
`rules/workers.mdc`. `workers-best-practices` and `durable-objects` bear directly on the
`getApp(env)` memoisation and the DO rate limiter. Worth enabling (requires the user to
authorise).

**0. Prove the driver.** `git init`, flake + `.envrc` + `.bun-version`, Bun workspaces with
`catalog:`, `tsconfig.base.json` + the two `apps/worker` configs, oxlint / dprint / knip / syncpack /
lefthook / secretlint, `@effect/tsgo`, vitest projects. Submodules pinned. **Generate the subpath
table.** Copy this plan to `docs/PLAN.md`. Then the **`cloudflare:sockets` `Duplex` adapter**:
`SELECT 1` through Hyperdrive in real `workerd`, then SCRAM-SHA-256, prepared statements,
`to_tsvector('dutch')`, an HNSW query. _This is the one unverified piece; everything else is
documented._

**1. One deploy serving both halves.** Alchemy provisioning the Worker + Hyperdrive + R2 + KV +
Queues; `GET /api/v1/health` through `HttpApiBuilder` plus the SSR shell. Proves the vite plugin, the
env→Layer root, the per-request door, the router-vs-SSR split and the single deploy.

**2. Migrations + the `Db` seam + RLS.** `effect/sql` Migrator, `Db.scoped`/`transaction`/
`unscopedForAuth`, RLS policies, an endpoint that **cannot compile** without `CurrentUser`.

**3. better-auth on Postgres**, mounted via `HttpEffect.fromWebHandler` inside the Effect router;
`AuthenticatedLive` → real `CurrentUser`; KV session cache; personal org on signup; the
generated-schema drift check in CI. Verify a second user in a second org sees nothing.

**4. Intake.** Upload → R2 → `source_documents` + `intakes` in one transaction → `DocumentParser`
(text only). A `.pdf` returns a typed `UnsupportedDocument` naming supported types.

**5. Extraction + the two model-free checks**, against the **scripted** model first so it lands in CI
green with no API key. Then flip to a real profile and compare. `CheckRule` gates from here on.

**6. Policy corpus + hybrid retrieval.** Chunk-by-heading + the contextual prefix; the RRF SQL
function; pgvector HNSW; `to_tsvector('dutch')`. **Gate: measure retrieval recall on the fixture
corpus against docket's 33/99 baseline before starting step 7.** If recall is materially below it,
fix retrieval — the queue UI will not reveal this, it will just be full.

**7. Decide, ending at `pending_review`.** Router exists but emits nothing. **Write the ~200-line
`WorkflowEngine` here** and express the pipeline as a `Workflow` with named `Activity`s (`Extract`,
`Retrieve`, `Decide`, `Judge`). Verify: fail the judge mid-run, redeliver, assert exactly one
extraction model call.

**8. Queues.** Verify: upload returns in <200 ms; a transient error retries then DLQs; a
`DocumentNotFound` acks immediately without burning retries; **redelivering a decide message makes
zero model calls**.

**9. The human boundary, and the one execution path.** Approve (CAS) → `emitExecute` → `executions`
claim → `DryRunAdapter`. _Then_ wire the router's `auto_approve` branch to **the same** function.
Verify: approve from two tabs → one event, one execution; an auto-approved decision produces a
byte-identical `executions` row shape.

**10. The reviewer's console.** Queue grid + inspector, span highlighting driven by
`containsVerbatim`, `j`/`k`/`a`/`r`.

**11. Evals on the real corpus**, scored against 33/99, thresholds in CI.

### Progress

| Step                             | State                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| 0 Prove the driver               | done — `@effect/sql-pg` over `cloudflare:sockets` verified in real workerd (ADR-0009) |
| 1 One deploy, both halves        | partial — API + OpenAPI live; the SSR shell is not built yet                          |
| 2 Migrations + `Db` seam + RLS   | done — 5 behavioural tenancy tests against real Postgres                              |
| 3 better-auth on Postgres        | done — schema generated from the installed library, drift-checked in CI               |
| 4 Intake                         | done — upload → R2 → two rows in one transaction; `.pdf` returns a typed 415          |
| 4.5 Architecture restructure     | done — slice × role × concept enforced by `dep:check` (ADR-0010)                      |
| 5 Extraction + model-free checks | next                                                                                  |
| 6–11                             | not started                                                                           |

Two things deferred rather than forgotten: the **SSR shell / reference client** from step 1, and
Alchemy, which is re-checked on each release (`bun add -D alchemy@latest && bun scripts/audit-effect-imports.ts node_modules/alchemy`;
it needs 0 unresolvable specifiers _and_ exactly one `effect@*` in the tree). Pulumi holds the
ground until then (ADR-0007).

## Risks

| #   | Risk                                                                                                                                                                                                                                                   | Mitigation                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **The escalation rate kills pilots.** Honest behaviour under poor retrieval is to escalate everything — correct, and indistinguishable from failure. The mirror risk is worse: weaker grounding _lowers_ `needs_human` and ships ungrounded decisions. | Report `groundedRate`, `needsHumanRate` **and** per-rail fire rates against 33/99, thresholds on each. **A falling `needsHumanRate` is an alarm, not a win.** Obligations index at 1.5.                                                                    |
| R2  | **`@effect/sql-pg` on workerd is unverified by execution.** No vendor or library support claim exists.                                                                                                                                                 | Milestone 0. The `stream` option makes it one adapter you own, not an architectural blocker. Avoid `rejectUnauthorized: false` (throws) and mTLS (`key`/`cert` silently ignored, workerd#7201).                                                            |
| R3  | **Hyperdrive caches reads for 60 s with no write-through invalidation.** A reviewer approving and seeing a stale queue is a bug.                                                                                                                       | **Two bindings**: one cached (static policy corpus), one `--caching-disabled` (queue, detail, all transactional reads). Watch the ~100-connection cap across configs.                                                                                      |
| R4  | **The lost-completion window can pay a supplier twice.** Unclosable in principle.                                                                                                                                                                      | Provider-side idempotency key in `AdapterRequest`; ambiguous `pending` never auto-retries; stuck claims go to a human. **ADR: no adapter without provider-side idempotency may be enabled with auto-approve armed.**                                       |
| R5  | **Decimal money on JS floats**, on the rail that checks totals.                                                                                                                                                                                        | Integer minor units end to end; no decimal library; `Cents` brand + integer columns; VAT in per-mille; one tested `parseMoney`; lint-ban `Number(x) * 100`.                                                                                                |
| R6  | **A parser version defines the verbatim contract**; a bump changes spans → grounding, silently.                                                                                                                                                        | Pin `anydoc` and the OCR model exactly; treat a bump like an Effect bump with an eval re-run. Scans return `UnsupportedDocument` until tier 3 lands, never a flattened best-effort parse.                                                                  |
| R7  | **The custom `WorkflowEngine` is ours to maintain**, with no exported conformance suite.                                                                                                                                                               | Stub suspend entirely (lint-enforced), shrinking the contract to `execute` + `activityExecute` + `poll` + `register`. Port the suspension discrimination verbatim. If real suspend is needed → Cloudflare Workflows (ADR-0003), not a bigger engine.       |
| R8  | **Mistral ZDR is Scale-plan-only and stateless-endpoints-only.**                                                                                                                                                                                       | The `mistral-eu` adapter uses stateless endpoints exclusively, asserted in code. Record the plan tier per client in `docs/runbooks/ProviderProfiles.md`.                                                                                                   |
| R9  | **Two schema generators, one database** — a better-auth bump silently wants a column.                                                                                                                                                                  | **`effect/sql` Migrator is authoritative.** `@better-auth/cli generate` output is pasted into a numbered migration and reviewed; `better-auth migrate` never runs; CI fails on drift. Our tables extend via side tables keyed by their ids, never `ALTER`. |
| R10 | **Three fast-moving deps** — Effect RC, `@cloudflare/vite-plugin`, Alchemy beta. The rc.109→rc.118 subpath move is direct evidence names shift within an RC series.                                                                                    | Exact `catalog:` pins, submodule at the matching sha, the regenerated API table, one smoke test per integration boundary. Alchemy: commit state, `plan` on PR, `wrangler` as fallback.                                                                     |
| R11 | **One Worker couples frontend and API deploys.**                                                                                                                                                                                                       | Gradual deployments with version pinning; the auxiliary split as a pre-approved ADR escape hatch.                                                                                                                                                          |
| R12 | **`getApp(env)` caches a binding object** — correct today, wrong when someone adds a per-request stub to `Env`.                                                                                                                                        | `RequestCtx` is separate by construction; a comment lists which binding kinds are safe; a test asserts `RequestCtx` never appears in a layer.                                                                                                              |
| R13 | **PlanetScale bills daily** — no $0 idle, which was the main cost argument for the all-Cloudflare variant.                                                                                                                                             | Accepted. One database serves all orgs in slice 1; per-client instances only when a client requires isolation.                                                                                                                                             |
| R14 | **Bun vs the Cloudflare toolchain.** `vitest-pool-workers` spawns `workerd`; `wrangler`/`alchemy` are Node-targeted.                                                                                                                                   | Run those under Node, the `node` vitest project under Bun. Verified at step 0. Bun stays the package manager and the runtime for everything it is good at.                                                                                                 |
| R15 | **Effect is a small talent pool; v4 RC docs are thin.**                                                                                                                                                                                                | The vendored submodule, the ADRs, and `docs/effect-v4-api-notes.md`. Price handover into a retainer honestly.                                                                                                                                              |

## ADRs to write at step 0

Each with the trigger that would make us revisit it, so they are decisions with expiry dates rather
than assertions.

| #    | Decision                                                  | Revisit when                                                                     |
| ---- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0001 | Single Worker with Assets, not an auxiliary Worker        | frontend and API need different deploy cadence or rollback                       |
| 0002 | PlanetScale Postgres via Hyperdrive, not D1               | data outgrows one instance, or $0 idle becomes the priority                      |
| 0003 | No `effect/cluster`; memo-only custom `WorkflowEngine`    | approval chains need genuinely multi-step durable suspend → Cloudflare Workflows |
| 0004 | pgvector, not Vectorize                                   | vectors exceed ~5M, or pgvector index tuning becomes the bottleneck              |
| 0005 | Org scoping: RLS **and** app-layer, neither trusted alone | never — this one is load-bearing                                                 |
| 0006 | Two provider profiles; OpenRouter is a US intermediary    | a client's residency requirement changes, or `@effect/ai-mistral` ships          |
| 0007 | Alchemy for IaC despite pre-1.0                           | a state corruption costs more than the typed-bindings win                        |
| 0008 | `source_span` before `value` is a hypothesis              | the eval harness A/Bs it — record the measured result                            |

## Verification

- `bun run preflight` — format, check, lint, hygiene, test (both vitest projects).
- `bun run evals:rule` — the model-free gate; every `nasty` case stopped, rail named.
- `bun run evals` — real corpus against docket's 33/99 baseline.
- `bun run dep:check` — the slice/role boundary rules plus the greps and the bundle assertion.
- The tenancy suite — every store method, as org A against org B's rows, on real Postgres.
- `vite dev` → real workerd locally; sign up, upload a fixture invoice, watch it reach
  `pending_review`, approve it, see one `DryRunAdapter` line.
- `bun alchemy deploy` → the same flow on the deployed origin.

## Reference files

- `docket/web/apps/server/src/Main.ts` — the working v4 composition root to adapt
- `docket/web/repos/effect/packages/effect/src/unstable/http/HttpEffect.ts` —
  `toWebHandlerLayerWith` (the build-once mechanism), `fromWebHandler` (the better-auth mount)
- `docket/web/repos/effect/packages/sql/pg/src/PgConnection.ts` — the `node:net`/`node:tls` dial and
  the `stream` escape hatch milestone 0 depends on
- `docket/web/repos/effect/packages/effect/src/unstable/ai/LanguageModel.ts` — `make` for the
  scripted double; `generateObject`/`resolveStructuredOutput` proving JSON-in-text
- `docket/web/repos/effect/packages/effect/src/unstable/workflow/WorkflowEngine.ts` — the 10-method
  interface the custom engine implements
- `docket/web/packages/database/src/OrgScope.ts` — the RLS `set_config` pattern to port
- `saas-starter/package.json`, `dprint.json`, `.oxlintrc.json`, `lefthook.yml` — the toolchain
- `docket/backend/app/decisions/rails.py`, `models.py`, `extraction/provenance.py` — the rails, the
  measured field order, the verbatim walker
- `docket/backend/app/workflows/document_decide.py`, `decision_execute.py` — the split at the human
  boundary and INSERT-before-call, in their original form
