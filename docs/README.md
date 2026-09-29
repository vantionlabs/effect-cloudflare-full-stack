# Documentation index

Four kinds of document, and the distinction is what keeps them useful:

| Kind          | Answers                                                              | Rule                                                                          |
| ------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Plan**      | what we are building and in what order                               | one file, kept current, states its own staleness                              |
| **ADR**       | why a decision was made, and **what would reverse it**               | never edited to look right in hindsight; a wrong reason is withdrawn in place |
| **Reference** | what is true of someone else's software, and **when it was checked** | every claim dated and traceable                                               |
| **Runbook**   | how to do a thing that is rare enough to forget                      | written before it is needed                                                   |

---

## Start here

| File                                                                                                                                                                                                                                                                     | What it is for                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [PLAN.md](./PLAN.md)                                                                                                                                                                                                                                                     | the build plan, the risk register, and a **Progress** table with the honest state of each step                                                  |
| [services.md](./services.md)                                                                                                                                                                                                                                             | **every service we run**: Cloudflare-native or not, why, and what it would take to move. Includes the public-API, telemetry and AI-Gateway gaps |
| [`cloudflare-full-stack.md`](cloudflare-full-stack.md) — what runs where, where configuration lives (`vars` vs secrets vs bindings vs CI secrets), the local development flow, and why the environments do not share a database. Start here if Cloudflare is new to you. |                                                                                                                                                 |
| [references.md](./references.md)                                                                                                                                                                                                                                         | dated external facts — npm versions, Cloudflare behaviour verified by request, Effect PRs in flight                                             |
| [effect-v4-api-notes.md](./effect-v4-api-notes.md)                                                                                                                                                                                                                       | the verified subpath table for the pinned RC. Regenerate on every bump                                                                          |

## Decisions (ADRs)

Each one ends in **Revisit when**, so these are decisions with expiry dates rather than assertions.

| #                                                             | Decision                                                                     | Note                                                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [0003](./adr/0003-workflow-engine-placement.md)               | No `effect/cluster`; a memo-only Postgres `WorkflowEngine`                   | **Revisit trigger is now close** — `@effect/platform-cloudflare` is building an official DO-backed engine |
| [0009](./adr/0009-cloudflare-sockets-pg-adapter.md)           | `@effect/sql-pg` over a `cloudflare:sockets` `Duplex`                        | the one piece that was unverified by execution, now verified                                              |
| [0010](./adr/0010-slice-role-concept-enforcement.md)          | slice × role × concept, enforced by `dep:check`                              | 502 file-rule checks                                                                                      |
| [0011](./adr/0011-one-modules-package.md)                     | one `@ea/modules` package, not eleven                                        | "it's not microservices"                                                                                  |
| [0012](./adr/0012-api-package-and-rpc.md)                     | `@ea/api` as a versioned manifest, HTTP **and** RPC                          |                                                                                                           |
| [0013](./adr/0013-provider-idempotency-gates-auto-approve.md) | no adapter without provider-side idempotency may run with auto-approve armed | a product rule, not an engineering one                                                                    |
| [0014](./adr/0014-no-rls-scoping-in-the-seam.md)              | no RLS; the `Db.scoped` seam plus a static check                             | **contains a withdrawn reason**, kept visible on purpose                                                  |
| [0015](./adr/0015-local-postgres-for-tests.md)                | tests run against a local container, not PlanetScale                         | 600× latency, measured                                                                                    |
| [0016](./adr/0016-rule-conditions-are-enforced.md)            | an auto-approve rule is a bounded authorisation                              | found by `evals:rule`: 190/300 released → 1/300                                                           |

**Superseded:** 0005 would have recorded "RLS _and_ app-layer, neither trusted alone"; it was implemented
and then reversed by 0014.

**Still gaps** — the decisions were made and are recorded in `PLAN.md`, but not as ADRs with revisit
triggers: **0001** (single Worker with Assets), **0002** (PlanetScale over D1), **0004** (pgvector over
Vectorize), **0006** (two provider profiles), **0007** (Alchemy vs Pulumi), **0008** (`source_span` before
`value` is a hypothesis). 0008 is now answerable the moment `bun run evals` can complete a scored run.

## Runbooks

| File                                                      | State                                                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ReEmbed.md](./runbooks/ReEmbed.md)                       | written — an embedding swap is a data migration, not a config change                                                                                          |
| [PatchingEffectDeps.md](./runbooks/PatchingEffectDeps.md) | written — how the Alchemy/RC-churn problem was diagnosed                                                                                                      |
| `UpgradeEffect.md`                                        | **missing.** `PLAN.md` calls for it; a bump needs the subpath table regenerated and the evals re-run                                                          |
| `ProviderProfiles.md`                                     | **missing.** `PLAN.md` calls for it; it should record each client's provider and plan tier, since Mistral ZDR is Scale-only and stateless-endpoints-only (R8) |

## Agent conventions

[agents/](./agents/) — issue tracker, triage labels, domain-doc layout. Referenced from the root
`AGENTS.md`, which also carries the filename conventions and a **Traps in this codebase** section worth
reading before touching SQL templates or `text[]` parameters.

---

## What is not written down yet

Listed because an undocumented gap is worse than a documented one:

- **`CONTEXT.md` at the repo root.** `AGENTS.md` declares the single-context layout and points at it; it
  does not exist. The domain narrative currently lives spread across `PLAN.md` and the ADRs.
- The two runbooks above.
- ADRs 0001, 0002, 0004, 0006, 0007, 0008.

## The checks that stop these docs from lying

Documentation decays; these fail the build instead. All run in `bun run preflight`.

| Check                             | Asserts                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bindings:check`                  | bindings are declared in every environment (non-inheritable), **and** every Pulumi resource kind is bound while every binding has a resource or a stated reason                           |
| `dep:check`                       | 502 boundary rules — domain is platform-free, only the composition root touches `*/server/*`, every tenant-table statement filters `organization_id`, exactly one `EmitExecute` call site |
| `auth:check`                      | the committed better-auth schema matches the installed library                                                                                                                            |
| `effect:verify`                   | the recorded subpath table matches the installed `effect`                                                                                                                                 |
| `db:verify`                       | the six platform assumptions hold against a given database                                                                                                                                |
| `evals:rule`                      | no labelled nasty reaches `auto_approve` with the model assumed wrong, except an explicitly ratcheted list                                                                                |
| `evals:retrieval`                 | retrieval recall floors (lexical ≥ 75%, hybrid ≥ 90% when the embedder is semantic)                                                                                                       |
| `knip` / `deps:check` / `secrets` | dead code, dependency drift, committed credentials                                                                                                                                        |

What **no** check asserts, and therefore still decays: the _statuses_ in `services.md` §1 — "in use"
versus "planned" is a claim about whether code reads a binding, and nothing verifies it.
