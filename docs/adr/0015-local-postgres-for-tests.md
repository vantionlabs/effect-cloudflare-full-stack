# ADR-0015 — Tests run against a local Postgres container, not against PlanetScale

**Status:** accepted · **Date:** 2026-09-29

## Context

With PlanetScale Postgres live behind Hyperdrive and migrations proven against it (ADR-0014's correction came
out of exactly that run), the obvious simplification is to delete `compose.yaml` and point everything —
`wrangler dev`, the test suite, the eval harness — at the real database. One Postgres, no Docker, no version
gap to manage, and every test exercising the engine production runs.

The version gap was real and is now closed the other way: the container was `pg17` (17.11) against a
production 18.6. That gap is a reason to _match versions_, and it was being used as a reason to _drop the
container_, which are different things.

## The measurement

Ten `select 1` round trips inside one already-established session, from this machine:

```
local container (localhost:55433)     0.17 – 0.89 ms      median ~0.20 ms
PlanetScale (us-east-5.pg.psdb.cloud)  118 – 126 ms       median ~120 ms
```

**600×.** It is not that PlanetScale is slow — it is that `us-east-5` is across an ocean, and a speed-of-light
round trip to Virginia is most of that number. Hyperdrive fixes this for the _deployed_ Worker by pooling at
the edge; it does nothing for a laptop or a CI runner talking to the origin directly.

What that costs, against a suite that is deliberately chatty because it uses real SQL and no fakes. Counted
with `pg_stat_database.xact_commit` across one run:

```
722 transactions per suite run
  local        13.98 s measured wall clock (150 tests, 19 files)
  PlanetScale  ≥ 87 s from round trips alone, ~4 min counting BEGIN/COMMIT
```

A 14-second suite is one you run on save. A four-minute suite is one you run before pushing, which means the
feedback that catches a tenancy leak arrives after the mistake has been built on.

## Decision

**The container stays, pinned to `pgvector/pgvector:0.8.5-pg18`** — same major as production, and pgvector
0.8.5 exactly, matching what `db:verify` reports for PlanetScale. `compose.yaml` and `.github/workflows/ci.yml`
use the same tag, so CI and a laptop cannot disagree.

Three reasons beyond latency, each independently sufficient:

1. **The suite is destructive.** It runs `migrate`, deletes fixture rows by id prefix, and truncates. Pointing
   it at a shared database means one `bun run test` racing another — two developers, or two CI jobs on two
   branches — and the failure is not a clean error, it is a test that passes for the wrong reason because
   another run had just seeded the row it was checking for.
2. **PlanetScale bills per database per day** (plan risk R13). A branch per developer plus a branch per CI job
   is the shape that would make this safe, and it is also the shape that multiplies the floor.
3. **A local Postgres is the portability claim.** "You could self-host this" is only demonstrable while the
   thing is actually demonstrated on every run.

## What does point at PlanetScale

Not nothing — the split is about which database each consumer needs:

| Consumer                  | Database                         | Why                                                        |
| ------------------------- | -------------------------------- | ---------------------------------------------------------- |
| `bun run test`            | container                        | destructive, chatty, must be fast and isolated             |
| `bun run evals:retrieval` | container (`PGHOST` overridable) | same, plus it migrates first on purpose                    |
| `bun run db:verify`       | whatever `DATABASE_URL` names    | its entire job is to interrogate a real provider           |
| `bun run db:migrate`      | whatever `DATABASE_URL` names    | how production gets its schema                             |
| `wrangler dev`            | either — one env var             | `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` |

That last row is the useful part of the original idea and it already works: to develop against the real
database, point that one variable at `DATABASE_URL` and restart `wrangler dev`. Tests keep their container.

## Revisit when

- **A region lands near the user.** At ~5 ms the arithmetic changes: 722 transactions becomes ~4 s and the
  case for a container is down to isolation and cost alone.
- **PlanetScale branches become cheap or free per branch**, which fixes isolation and cost together. Then a
  branch-per-CI-job is strictly better than a container, because it removes the last version gap.
- **The suite stops being chatty** — but it should not, since the queries are the thing under test.
