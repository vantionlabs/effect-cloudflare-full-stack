# ADR-0002 — Neon Postgres via Hyperdrive, not PlanetScale, not D1

**Status:** accepted · **Date:** 2026-09-29 · **Supersedes** the unwritten "PlanetScale Postgres via
Hyperdrive" decision that `PLAN.md` recorded and that ran in production for one day.

## Context

This ADR was on the to-write list under the title _"PlanetScale Postgres via Hyperdrive, not D1"_, with the
revisit trigger **"data outgrows one instance, or $0 idle becomes the priority."** It is being written for
the first time after that trigger fired, so it records the decision that holds rather than revising one
that never existed.

The D1 half of the original reasoning is unchanged and still correct — see **What survives** below. What
changed is the Postgres provider.

### Why PlanetScale was left

Not a fault in the product. Three things, in order of weight:

**1. Every environment is a whole database, always on.** PlanetScale bills per branch, daily, from creation
until deletion, and a new Postgres branch initialises as its own isolated instance. The list rate for the
PS-5 the project ran on is **$15/mo** in `aws-us-east-1`. Three environments is three of those, running
24/7 whether or not anyone is using them. For a portfolio build that idles most of the week, the floor
_was_ the cost.

**2. A PlanetScale Postgres branch starts empty.** The docs are explicit: _"This method does not include
schema or data"_ and _"Choose the base branch. This currently does not copy the schema."_ That is not a
defect — it is fine, because `effect/sql`'s Migrator is authoritative here — but it means branches buy
nothing over separate databases while costing the same.

**3. The data was in Virginia.** `PLAN.md` treats EU residency as _client-blocking_ for the Dutch SME and
solves it with the `mistral-eu` provider profile. That profile governs where the **model** runs. The
database was `AWS us-east-1 (N. Virginia)`, so the documents, extractions, decisions and citations — the
actual customer data — were not in the EU at all. The residency claim did not hold for the data, and
nothing in the repo said so.

## Decision

**Three Neon projects — production, staging, dev — all in `aws-eu-central-1` (Frankfurt), each reached
through two Hyperdrive configs.** PlanetScale is removed entirely.

### Verified by execution, not by documentation

Every capability this codebase rests on was checked against a real Neon instance before the move, because
"Postgres is Postgres" is the kind of claim that is true until the one extension you need is missing:

|                                                           | Neon                                                                                                                     | PlanetScale (was)     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| Server version                                            | **PostgreSQL 18.6**                                                                                                      | 18.6 — identical      |
| pgvector                                                  | **0.8.6**                                                                                                                | 0.8.5 — Neon is newer |
| `dutch` text search config                                | present, **and actually stems** (singular query matched plural text)                                                     | present               |
| `to_tsvector` immutability for the generated `tsv` column | `provolatile=i`                                                                                                          | same                  |
| Connecting role                                           | `neondb_owner`, **superuser=false**                                                                                      | bootstrap superuser   |
| All 15 migrations                                         | applied clean → 19 tables, `retrieve_policy` created                                                                     | same                  |
| RRF hybrid retrieval                                      | works; score `1/(60+2)+1/(60+1) = 0.032522` exactly as reported; Dutch put the payment-terms clause at `lexical_rank: 1` | same                  |
| Tenancy isolation                                         | 3 rows for the owning org, **0** for another org, **0** for the wrong collection                                         | same                  |
| `pgvectorscale`                                           | **not available**                                                                                                        | available, unused     |

The one regression is `pgvectorscale`, which `PLAN.md` listed as a bonus and which nothing uses.

Non-superuser is an improvement rather than a cost: a superuser connection is what let the
`effect_ai_app` grant bug hide locally, per `AGENTS.md`.

### Two Hyperdrive configs per environment, which is plan risk R3

Hyperdrive caches reads for 60s with `stale_while_revalidate` 15s and **does not invalidate on write**. A
reviewer who approves a decision and then sees a sixty-second-stale queue is a bug, so each environment
gets two configs against the same database:

| binding             | caching      | for                                                                               |
| ------------------- | ------------ | --------------------------------------------------------------------------------- |
| `HYPERDRIVE`        | **disabled** | the review queue, decision detail, every write and any read that must observe one |
| `HYPERDRIVE_CACHED` | on           | the policy corpus only — it changes at ingest and is otherwise static             |

`HYPERDRIVE_CACHED` is **declared and bound but not yet consumed**: `Connect` is a single port, so routing
corpus reads through it is a threading change in the retrieval path, not a config edit. It is typed on
`Env` so the binding that exists is the binding the code names.

### The direct endpoint, never the pooler

Neon's connection string defaults to a `-pooler` host. That is PgBouncer in transaction mode, and Hyperdrive
is **also** a transaction-mode pooler, so stacking them is what breaks `@effect/sql-pg`'s named prepared
statements. Neon says so themselves: _"Actually, we don't recommend it. Since Hyperdrive maintains its own
global pool of database connections, which your application reuses for queries, this makes Neon's pooling
unnecessary."_ Every Hyperdrive config here points at the **direct** host.

### Separate projects, not branches

Neon's free-plan allowances are **per project** — 100 CU-hours, 0.5 GB storage, 5 GB egress — so three
projects is three independent budgets rather than three tenants of one. It also gives complete isolation,
which matters here for reasons beyond tidiness:

1. **Migrations run forward on deploy.** A shared database means staging's migration alters production's
   tables before production's code ships.
2. **The product's entire claim is an auditable decision trail.** Test decisions interleaved with real ones
   in `decisions` and `decision_citations` destroy the thing being sold.
3. **`decisions.decide_key` and `document_fingerprints` are UNIQUE.** Staging replaying a fixture invoice
   would collide with, or silently suppress, a production decision.

Nothing is shared across environments: separate Neon project, R2 bucket, queue, dead-letter queue and KV
namespace each. The R2 buckets carry the `weur` location hint, because the documents are customer data and
placing the database in the EU while the PDFs sit elsewhere would be the same half-measure as before.

### What scale-to-zero actually gives, stated precisely

Neon suspends a compute after **5 minutes** idle (free plan, not disableable). Hyperdrive closes idle
origin connections after **10 minutes** (documented in its limits table, same on free and paid). So a
compute suspends roughly **15 minutes** after the last query, not 5 — every burst of traffic costs about a
quarter-hour of compute floor.

That is still far inside the free allowance for bursty use: 100 CU-hours at 0.25 CU is 400 hours, and
suspended computes accrue nothing (_"Computes that are suspended do not accrue CU-hours"_). The failure
mode is a **hard stop, never a surprise bill** — exceeding CU-hours suspends the compute until the next
period, exceeding 0.5 GB makes writes fail, and neither deletes data.

**The thing to avoid is a naive uptime monitor.** Anything polling `/api/v1/health` more often than every
~15 minutes keeps the compute awake permanently, which is 0.25 CU × 730 h = 182 CU-hours and blows through
the 100 CU-hour free allowance in under three weeks.

## What survives from the original reasoning

The case against **D1** is untouched: D1 routes _"all queries (both read and write) to a specific database
instance in one location"_, so it was never multi-region; `dutch` stemming would have to be hand-rolled;
RRF hybrid search in one SQL function would become two stores fused in Worker code; and D1 writes are
$1.00/M rows against a workload that writes provenance on every decision.

The case against **Vectorize** is untouched and is the stronger one: one store means the vector and the
citable text cannot diverge, which is load-bearing for a product whose claim is that every citation is
auditable.

ADR-0009's `cloudflare:sockets` adapter is unaffected — it speaks the Postgres wire protocol and does not
care who is on the other end. ADR-0015's local test container is unaffected and was re-confirmed: Neon is
PG 18.6 and `compose.yaml` is `pgvector/pgvector:0.8.5-pg18`, so the fidelity argument still holds, and the
600× latency measurement is exactly why per-PR remote branches are **not** adopted for the test suite.

## What this costs

- **No consolidated Cloudflare billing.** PlanetScale was `cloudflare_billed: true` with Cloudflare credits
  applying. Neon bills separately.
- **Cold starts.** Five-minute suspend is not disableable on the free plan, so the first request after idle
  pays a resume. A reviewer clicking in after lunch waits a second or two.
- **0.5 GB per project** on free. Ample for the current corpus — 1024-dim embeddings are 4 KB each, so even
  10,000 chunks is ~40 MB — but it is a ceiling, and exceeding it fails writes rather than degrading.
- **No GDPR/SOC 2 certification on free.** The EU **region** is free; the EU **compliance paperwork** is a
  Scale-plan feature. Region and certification are different claims and a client will ask for the second.

## Revisit when

- **A paying client signs.** Then the free plan's inability to disable scale-to-zero, the 0.5 GB ceiling and
  the missing compliance certifications all become real, and the answer is the Launch or Scale plan — not a
  different provider.
- **Sustained traffic makes the compute effectively always-on.** At that point metered compute stops being
  cheaper than a fixed instance, and the comparison against PlanetScale should be re-run with real numbers
  instead of a projection.
- **Storage approaches 0.5 GB**, which for this schema means the embedding table rather than the documents.
- **`HYPERDRIVE_CACHED` is still unconsumed.** It is a declared intention until the retrieval path uses it;
  if that has not happened, either finish it or delete the binding rather than leaving a config that implies
  a behaviour the code does not have.
