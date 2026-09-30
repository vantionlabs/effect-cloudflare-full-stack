# ADR-0018 — A room is stateless fan-out; Postgres stays the record

**Status:** accepted · **Date:** 2026-09-30

## Context

Realtime needs a coordination point: every client watching an organization's queue has to be told when it
changes, and clients are spread across the world. The instinct from a fleet of stateless nodes is a bus —
Redis pub/sub, or a presence set with TTL heartbeats — because there each node holds some sockets and no node
knows the others'.

A Durable Object **is** that point. One name resolves to exactly one instance globally, so there are no peers
to synchronise with and no bus to run. The design question is therefore not "how do nodes reach each other"
but "what may a room hold", and the answer is not obvious: it has 10 GB of SQLite sitting right there.

## Decision

**A room holds nothing durable.** Postgres is the record; a room fans out frames and derives presence from the
live socket set. The write path is: client → RPC → Postgres (inside `Db.scoped`) → _then_ the Worker asks the
room to broadcast what is already persisted. A reconnecting client catches up from Postgres, never from a room.

Four reasons, each sufficient alone:

1. **The 15-minute billing rule.** An outbound `connect()` keeps a Durable Object resident and billable for up
   to 15 minutes, and our Postgres client dials through `cloudflare:sockets` (ADR-0009). A room that wrote to
   the database would stay billable for a quarter of an hour after every message, defeating hibernation — the
   difference between Cloudflare's own $20/month and $412/month worked examples. Hence ADR-0019.
2. **It is this repo's existing thesis.** "A pending decision is a database row anyone can query rather than a
   suspended coroutine somebody has to trust" (PLAN.md). A message in a room's private SQLite is the
   coroutine.
3. **Tenancy is already solved once.** ADR-0014 puts org scoping in `Db.scoped` with a static check. A room
   with its own storage is a second scoping mechanism, checked by nothing.
4. **One source cannot disagree with itself.** The tempting optimisation — a ring buffer of recent messages in
   the room — is a second copy with its own eviction rule, and its failure mode is a reconnecting client
   seeing a different history from a reloading one.

**Presence is the exception that proves it.** It is _derived_, every time, from `getWebSockets()` plus each
socket's `serializeAttachment`. That is strictly better than a Redis presence set rather than merely simpler: a
crashed node cannot delete its own entries, so a set needs TTLs and shows ghosts until they expire, whereas a
disconnected socket is simply not returned. The corollary is that presence must **not** be persisted — it is
meaningful only while sockets exist.

## Consequences

- **A room is disposable.** It stores nothing, so a badly-placed one is fixed by letting it die and be
  recreated. That matters because a Durable Object is created near its first request and **never relocates**:
  placement is otherwise permanent. Nobody planned this dividend; it fell out of the decision.
- **Class lifecycle is nearly free.** Deleting a Durable Object class deletes its storage. Ours holds nothing
  anyone could lose, so a rename is an `exports` edit rather than a migration with consequences.
- **Every live update costs a round trip to Postgres.** A frame is a nudge carrying no rows, so a client that
  receives one re-reads. Deliberate: the queue is fifty rows behind one query, and the alternative is queue
  data arriving by two routes that can disagree.
- **A per-room throughput ceiling of roughly 500–1,000 requests per second**, and all of an organization's
  traffic routed to wherever its room lives. Sharding by organization is what keeps that survivable; the
  documented anti-pattern is one object for everybody.

## Revisit when

- **Catch-up latency from Postgres becomes the bottleneck** — a thread with thousands of messages where
  clients reconnect often. Then a bounded cache in the room earns its keep, and the thing to write down is
  its eviction rule.
- **A room needs to answer something no query can**, such as a CRDT for collaborative editing, where the
  authoritative state genuinely is the in-flight one.
- **`@effect/platform-cloudflare` ships** (PR #7322, unpublished). Its `ClusterEntity` is the shape this
  hand-rolls. Reassess — but reassess the **billing** too rather than assuming it is solved: an entity that
  reaches Postgres from inside a Durable Object hits the same 15-minute rule.
