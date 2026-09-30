# Chat and realtime on Durable Objects

**Status:** ready-for-agent · **Written:** 2026-09-29 · **Slug:** `chat-realtime`

## What this is for

PLAN.md calls this repo a playground for AI engineering, B2B SaaS and realtime — and a starter for client
work. Realtime is the one leg with nothing built. This spec covers it, and it is deliberately not "add
chat": it separates three features that get lumped together, because **only two of them want a Durable
Object and the third is actively worse with one.**

| # | Feature                                                                           | Shape                                 | Needs a DO? |
| - | --------------------------------------------------------------------------------- | ------------------------------------- | ----------- |
| A | **AI chat over the corpus** — a reviewer asks why a clause applies                | one user, streaming tokens            | **No**      |
| B | **A thread on a decision** — two reviewers discuss a queue item                   | many users, one subject, must fan out | **Yes**     |
| C | **Live queue and presence** — the queue changed; somebody else is looking at this | many users, one org                   | **Yes**     |

**A does not need one and must not get one.** A single user streaming from a model needs no coordination:
the Worker streams the response and writes the transcript. Putting that in a Durable Object adds a hop, a
second place state lives, and — because the model call is an outbound connection — up to 15 minutes of
billable duration per exchange (see `docs/references.md`). The DO is for _fan-out and ordering between
clients_, which is exactly what A has none of. Building A first, without a DO, is how we keep that honest.

## The decision this whole design rests on

**A room is stateless fan-out. Postgres remains the record.**

Everything else follows. A client sends a message over normal RPC to the Worker; the Worker writes it to
Postgres inside the existing `Db.scoped` seam and gets back its identity; the Worker then tells the room to
broadcast the already-persisted message; connected sockets receive it. A reconnecting client catches up
**from Postgres** ("everything after seq N"), not from the room.

Four reasons, each sufficient on its own:

1. **The 15-minute billing rule.** An outbound `connect()` keeps a DO in memory and billable for up to 15
   minutes, and our Postgres client dials through `cloudflare:sockets` `connect()` (ADR-0009). A room that
   wrote to the database would stay billable for a quarter of an hour after every message, defeating
   hibernation — the property that makes a room cost $20/month instead of $400 in Cloudflare's own worked
   examples. **So a room may never hold a `PgClient`**, and once it cannot write, it should not be the
   record either.
2. **It is this repo's existing thesis.** "A pending decision is a database row anyone can query rather
   than a suspended coroutine somebody has to trust" (PLAN.md §durable execution). A message in a room's
   private SQLite is the coroutine.
3. **Tenancy is already solved in one place.** ADR-0014 puts org scoping in the `Db.scoped` seam with a
   static check that every store method carries it. A room with its own storage is a second scoping
   mechanism, checked by nothing.
4. **Catch-up from one source cannot disagree with itself.** The obvious optimisation — a ring buffer in
   the room for recent messages — is a second copy of the same data with its own eviction rule, and the
   failure mode is a reconnecting client seeing a different history from a reloading one.

The room therefore stores **nothing**. The socket set survives hibernation through the runtime's own
`ctx.getWebSockets()` and `serializeAttachment`, not through our code. It still declares
`storage: "sqlite"`, because that is the only backend available to new namespaces and the free plan.

## Architecture

```
browser ──WS──> console Worker ──service binding──> API Worker ──> RoomDO
   │                                                    │   (fan-out only, no DB, hibernating)
   └──RPC/HTTP──> console ──binding──> API ──Db.scoped──> Postgres   (the record)
```

- **One room per subject, named from the resolved session, never from the client.**
  `decision:<orgId>:<decisionId>` for B, `org:<orgId>` for C. The `orgId` comes from `resolveIdentity` on
  the upgrade request; a client that names its own room is how one tenant reads another's, so the name is
  constructed server-side from a value the client cannot influence. The subject id is additionally checked
  to belong to that org in Postgres before the upgrade is accepted.
- **Auth happens on the upgrade**, which is an ordinary HTTP request carrying the session cookie
  first-party (the console and the API are one origin — ADR-0001, and `apps/console/src/server.ts`).
- **Sockets are short-lived on purpose.** A session revoked mid-connection would otherwise keep streaming
  to somebody who has signed out, because the cookie was only checked once. A room closes sockets after a
  bounded lifetime and the client reconnects, which re-authenticates. The bound is a product decision;
  start at 30 minutes and write the reason next to it.
- **Keepalive uses `setWebSocketAutoResponse`**, so a ping does not wake a hibernating room. No
  `setInterval` anywhere in a room: a timer prevents hibernation, which is the whole point of the design.

## Transport: a push-only socket, and why it cannot carry Effect RPC

**The socket is one-way, server to client.** Client actions — post a message, mark a thread read — go over
the existing HTTP RPC path, which is already typed from the same contract, already authenticated by the
session cookie, and already works. Only pushes need the socket.

That asymmetry is not a simplification, it is forced, and working it out corrected an earlier version of
this spec which said chat would "join the existing `RpcGroup` over a WebSocket":

**Hibernation and Effect's WebSocket RPC are mutually exclusive.** Hibernation is _defined_ by the room
leaving memory while its sockets stay connected: delivery becomes callback-based and stateless per message
(`webSocketMessage(ws, msg)`), and the socket set is recovered from `ctx.getWebSockets()`. But
`RpcServer.layerProtocolWebsocket` keeps a **protocol session in memory for each connection** — that is what
`makeSocketProtocol` is — and a streaming rpc additionally keeps a **server fiber alive** for as long as the
subscription lasts. Anything held in memory per connection means the room can never leave memory, which
means `accept()` rather than `ctx.acceptWebSocket()`, which bills wall-clock for the entire time every
client is connected. In Cloudflare's own worked examples that is **$412/month against $20/month** for
identical traffic.

It cannot be patched by restoring protocol state on wake. `serializeAttachment` holds a small value per
socket, not an RPC session, so the room would be rebuilding a protocol handshake on every message.

**So room frames are self-contained**: a `Schema`-encoded tagged union, encoded once per broadcast and sent
with `ws.send`. Schema still gives one definition shared by both ends — the property that made RPC
attractive — without a session to keep alive.

**This demotes the `request.upgrade` question** (issue 01) from blocking to informational. The room must
upgrade with `ctx.acceptWebSocket()`, a Durable Object API, so Effect's socket protocol is the wrong tool
here whether or not `request.upgrade` resolves under `workerd`. It stays worth knowing for a future
non-hibernating use — an RPC stream terminating in the Worker rather than in a room — which is why the issue
is kept rather than deleted.

## Which Effect primitives, and where

The question "PubSub, cluster, Stream, Sink?" has a different answer per feature, and the wrong answer is
expensive rather than merely inelegant.

| Primitive             | Used here?                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`PubSub`**          | **No**                            | It is in-memory and **per isolate**. Two browsers are usually served by two isolates, so a publish reaches a subset of subscribers and reports success — silent partial fan-out, the worst failure shape. It also needs a resident subscriber fiber per socket, which is the hibernation problem again. The Durable Object _is_ the coordination point `PubSub` would be imitating, so it adds nothing and costs the thing that makes rooms affordable.                                                        |
| **`Queue`**           | **No**, in a room                 | Same reason: a queue with no consumer fiber is a leak, and a consumer fiber is residency.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **`Stream` / `Sink`** | **Yes — on feature A**            | Feature A is a streaming rpc (`stream: true`) over the **HTTP** protocol, which `makeProtocolHttp` supports directly: no hand-rolled SSE. Token generation is a `Stream`; persisting the transcript while it streams is a `Sink` on a forked branch, so the record is written from the same bytes the client saw rather than from a second call. This is where these primitives belong — one request's lifetime, inside the Worker, where a fiber is alive anyway and Workers bill CPU rather than wall-clock. |
| **`effect/cluster`**  | **No** (ADR-0003)                 | Designed for N long-lived processes over a shared transactional database; `SqlMessageStorage` calls `withTransaction` in nine places and sharding runs background loops on 3/10/35/60-second timers. Every one of those is residency inside a room, and the transactions imply a `PgClient`, which is the 15-minute rule.                                                                                                                                                                                      |
| **Room fan-out**      | `ctx.getWebSockets()` + `ws.send` | A synchronous loop inside a handler. No fibers, no subscriptions, nothing to restore on wake. This is the whole room.                                                                                                                                                                                                                                                                                                                                                                                          |

**`effect/cluster` is also the revisit trigger, with a caveat.** `@effect/platform-cloudflare` (PR #7322,
unpublished — `docs/references.md`) ships `ClusterEntity` and `ClusterWorkflow` as SQLite-backed Durable
Object classes, and an entity per room is the shape this design is hand-rolling. When it releases, reassess
— but reassess the **billing** too rather than assuming it is solved: an entity that reaches Postgres from
inside a DO hits the same outbound-connection rule, and the PR explicitly ships "no HttpServer/Crypto/FS
parity", so the pieces that are ours stay ours.

## Running Effect inside a Durable Object

The room holds a runtime built **once per DO instance**, mirroring `getApp(env)` per isolate in
`apps/worker/src/Main.ts`. Two rules, both derived from mistakes this repo already documents:

- **The room's layer must not contain `PgClient`.** See above; this is the design's central constraint and
  belongs in a comment next to the layer, not only in a spec.
- **Nothing request-scoped may be memoised.** `RequestCtx` is separate from `Bindings` for this reason
  (PLAN.md R12), and a DO instance outlives a request just as an isolate does.

## Tenancy, tested the way the rest is

ADR-0014's tenancy suite asserts every store method as org A against org B's rows, keyed on
`keyof StoreService` so a new method without a case **fails to compile**. Rooms get the equivalent:

- org A cannot reach `decision:<orgB>:<id>` by naming it, because the name is built from the session;
- org A cannot reach it by passing org B's `decisionId`, because the subject's ownership is checked in
  Postgres before the upgrade;
- a message broadcast in one room never appears in another.

The third is a fan-out property, not a query property, so it needs two live sockets — which is what the
browser tier (ADR-0017) is for: two browser contexts, two sessions, one assertion.

## Build order

**0. Verify, before designing on top of it.** `request.upgrade` under `workerd`; a WebSocket upgrade
through a **service binding** (the console forwards `/api/*` to the API — if 101 does not pass through, the
console binds the DO namespace directly with `script_name`, which is the documented alternative); and
`runInDurableObject` in `vitest-pool-workers`. Record each in `docs/references.md` with the date.

**1. Feature C, the smallest useful thing: live queue + presence.** One room per org, no messages, no
history — it broadcasts "the queue changed" and "who is looking at this". It proves the whole topology
(upgrade, auth, naming, hibernation, fan-out) with no persistence question in the way, and it makes the
existing queue better immediately: today a reviewer cannot tell that a colleague is about to approve the
same invoice.

**2. Feature B: threads on a decision.** `decision_comments` in Postgres with the usual org column and the
usual seam; write over RPC, broadcast through the room, catch up by seq. Nothing new in the room.

**3. Feature A: AI chat over the corpus, with no DO at all.** Streams from the Worker, retrieval through
the existing hybrid search, transcript in Postgres, `@tanstack/ai` on the client. This is where the
"AI engineering playground" claim gets its surface, and it deliberately arrives third so the DO is not
reached for out of habit.

**4. Cost control before it is a problem.** Batch broadcasts, `setWebSocketAutoResponse` for ping/pong, and
a deliberate decision about typing indicators — at a 1/20 request ratio and 100,000 requests/day on the
free plan, per-keystroke broadcast is a way to take the demo down at 00:00 UTC.

**5. The rate-limit DO.** PLAN.md already calls a DO per API key "the one place a Durable Object genuinely
earns its keep" — it reuses this plumbing, so it lands last and cheaply.

## Risks

| #  | Risk                                                                                                                    | Mitigation                                                                                                                                                              |
| -- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 | **A room that touches Postgres silently costs 20× more.** The failure is a bill, not an error, so nothing will tell us. | The layer cannot contain `PgClient`; a `dep:check` rule that forbids `*/server/*` database imports from the DO module, so it is a build failure rather than an invoice. |
| R2 | **`request.upgrade` may not work under `workerd`.**                                                                     | Step 0. Fallback is `WebSocketPair` with Schema frames; the contract survives either way.                                                                               |
| R3 | **A WebSocket may not survive a service binding.**                                                                      | Step 0. Fallback: the console binds the DO namespace with `script_name`.                                                                                                |
| R4 | **Free-plan daily limits fail operations rather than throttling**, and reset at 00:00 UTC.                              | Batching, auto-response pings, no per-keystroke anything, and a documented expectation that this is a playground on a free plan.                                        |
| R5 | **A revoked session keeps streaming** because the cookie is checked once, at upgrade.                                   | Bounded socket lifetime and reconnect. Name the bound and the reason in code.                                                                                           |
| R6 | **DO class migrations are not free.** Renaming a class needs a migration entry; deleting one deletes its storage.       | The room stores nothing, which makes this nearly free for us — a reason to keep it that way.                                                                            |
| R7 | **Duplicates and gaps on reconnect.**                                                                                   | Postgres identity is the ordering authority; catch-up is "after seq N"; the client merges by message id idempotently.                                                   |
| R8 | **"Chat" attracts scope.** Reactions, edits, attachments, read receipts, @-mentions with notifications.                 | Each is a separate issue file with its own reason to exist, or it does not get built.                                                                                   |

## ADRs this will produce

| #    | Decision                                              | Revisit when                                                                                                   |
| ---- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 0018 | A room is stateless fan-out; Postgres is the record   | catch-up latency from Postgres becomes the bottleneck, or a room needs to answer something no query can        |
| 0019 | No `PgClient` in a Durable Object                     | Cloudflare changes the 15-minute outbound-connection rule, or Hyperdrive becomes reachable without `connect()` |
| 0020 | Chat rides the existing RPC contract over a WebSocket | step 0 says `request.upgrade` does not hold under `workerd`                                                    |
