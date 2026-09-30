# ADR-0019 — No database client in a Durable Object

**Status:** accepted · **Date:** 2026-09-30

## Context

A room is a natural place to put a write. It already knows who is connected and what just happened, and
`this.ctx.storage` and a `PgClient` are both one import away. The reason not to is a billing rule that nothing
in the code would reveal.

**The rule** (`docs/references.md`, checked 2026-09-30): an active outbound connection — `connect()` or an
outbound WebSocket — keeps a Durable Object in memory and **billable for up to 15 minutes**, even with no
incoming requests. It exists so that streaming from a model is not cut off by eviction, which is a good reason;
it is also a trap for anything else that dials out.

Our Postgres client dials through `cloudflare:sockets` `connect()` (ADR-0009). So a room that touched the
database would hold a socket, stay resident, and accrue wall-clock duration charges for fifteen minutes after
every write — on every room, for every organization. Cloudflare's own worked examples put the difference
between a hibernating design and a resident one at **$20/month versus $412/month** for identical traffic.

## Decision

**A Durable Object in this repo may not import a database client, and the boundary is enforced statically.**
`bun run dep:check` forbids `@effect/sql-pg`, `pg` and `@ea/modules/*/tables/*` from `apps/worker/src/Room*`,
so the mistake is a failed build rather than an invoice next month.

Writes happen in the Worker, which already owns connection lifetime per request. The room is told what to
broadcast after the write has landed.

## Consequences

- **Two hops for a write that announces itself**: client → Worker → Postgres, then Worker → room. A single hop
  would be cheaper in latency and vastly more expensive in duration.
- **A room cannot re-check a session**, because it cannot query. That is why the upgrade authenticates once
  and sockets are retired after a bounded lifetime so a revoked session stops receiving data.
- **A room cannot validate the identity it is handed.** The guarantee is structural instead: a Durable Object
  namespace is reachable only from a Worker in the same account, and the single route that reaches this one
  resolves a session first and overwrites the identity header from it.
- **The cost of the rule is invisible**, which is the argument for a check rather than a comment. Nothing
  fails, nothing logs, and the code reads perfectly well — it just costs twenty times more.

## Revisit when

- **Cloudflare changes the outbound-connection rule**, or Hyperdrive becomes reachable from a Durable Object
  without `connect()`. Then the reason evaporates and the check should go with it.
- **A feature genuinely needs transactional state next to the socket** — a CRDT, or a rate limiter that must
  be exact. Note the rate limiter is already a different case: it is only alive while a key is in use, so
  residency costs nothing there (issue 08).
