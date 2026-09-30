# External references, dated

Claims about other people's software decay. This file records where a claim came from and **when it was
true**, so a reader can tell a stale fact from a wrong one. Anything asserted in an ADR or in
`services.md` about an external project should be traceable to a row here.

Verified by execution or by reading the source where possible, rather than by reading marketing.

---

## Effect

### `@effect/platform-cloudflare` — does not exist on npm, is being actively built

**Checked 2026-09-29.** `npm view @effect/platform-cloudflare` → 404, as do
`@effect/platform-cloudflare-workers`, `@effect/cloudflare`, `@effect/cloudflare-workers`. So nothing is
installable today.

**But it is real and in flight.** [Effect-TS/effect#7322 — "Cluster sharding on Cloudflare Durable
Objects"](https://github.com/Effect-TS/effect/pull/7322): open, not a draft, created 2026-08-18, last
updated 2026-09-24, **+14,344/−105**. Closes EFF-698. The PR describes itself as a shared branch where
"serial slices land one by one", and several have already merged independently:

| PR                                                     | State  | What                                              |
| ------------------------------------------------------ | ------ | ------------------------------------------------- |
| [#7322](https://github.com/Effect-TS/effect/pull/7322) | open   | the package itself: `@effect/platform-cloudflare` |
| [#7345](https://github.com/Effect-TS/effect/pull/7345) | merged | honour uninterruptible Cloudflare entity requests |
| [#7346](https://github.com/Effect-TS/effect/pull/7346) | merged | fix concurrent Cloudflare entity handler builds   |
| [#7550](https://github.com/Effect-TS/effect/pull/7550) | merged | Alchemy deployment for the Cloudflare cluster     |
| [#7927](https://github.com/Effect-TS/effect/pull/7927) | merged | reduce web handler cold start on Cloudflare       |

**What the package contains** (from the PR's own file list and body):

- **`CloudflareWorkflowEngine.ts`**, with `internal/workflowStorage`, `workflowRuntime`,
  `workflowRegistry` and `workflowWire`, plus a unit test and an integration test. **This is an official
  `WorkflowEngine` implementation backed by Durable Objects** — see ADR-0003, which it directly bears on.
- Four SQLite-backed Durable Object classes the Worker re-exports and binds: `ClusterEntity`,
  `ClusterWorkflow`, `ClusterDurableQueue`, `ClusterSingleton`.
- `CloudflareCluster.layer({ entities, entityNamespace, workflowNamespace, queueNamespace,
  singletonNamespace })` providing the cluster `Sharding` service.
- A length-prefixed name codec, a cheap entity constructor (SQLite opened and the alarm re-armed without
  building user handlers), and `makeRunnerAddress` deriving a synthetic runner address from DO identity
  with no peer dialing.

**What it explicitly does NOT contain**, quoting the PR: _"cluster plus the minimum Worker/DO glue; **no
HttpServer/Crypto/FS parity**"_. This matters for us more than the inclusions do — it means the pieces we
hand-rolled stay ours for the foreseeable future: the `cloudflare:sockets` Postgres `Duplex` (ADR-0009),
`HttpRouter.toWebHandler` serving, and the structural binding interfaces. See `services.md` §8.

**Status to quote:** in development, unreleased, and the maintainers have asked for no feedback yet.

### Effect office hours, 2026-09-26 — cluster, workflows, and the Cloudflare work

<https://youtu.be/wK6vW_Xfbhs> · Maxwell Brown (Effect core). The parts that bear on this repo:

**It confirms the reasoning in ADR-0003, independently.** ADR-0003 concluded from reading the source that
`effect/cluster` is built for N long-lived processes over a shared transactional database and that no
Durable Object runner existed. Verbatim from the stream:

> "right now cluster is really designed for persistent servers. So it's not really compatible with
> serverless architecture right now."

and on the work to change that:

> "there is a work stream ongoing within the team right now to see if we can get cluster to be more
> compatible with serverless architecture … we're using Cloudflare's durable objects as our initial
> target."

**It confirms why our own engine had to be written.** ADR-0003 rests on `WorkflowEngine` being a
10-method interface with exported helpers for writing another. Confirmed:

> "to implement effect workflows, you have to have a workflow engine layer provided … right now we only
> have a cluster workflow engine. We have an in-memory one too, but that's not really durable."

So as of that date the only options were `ClusterWorkflowEngine` (needs a persistent cluster) and
`layerMemory` (not durable). Our Postgres engine was not reinventing an available wheel.

**It confirms workflows are independent of cluster** — the separation this repo depends on:

> "workflows do not need to be run on an effect cluster … In theory you could make a workflow engine that
> allows effect workflows to run on like temporal or something."

**It dates the maturity of the Cloudflare work**, which is the part that changes a decision:

> "this PR is like extremely early, so please do not flood this PR with feedback. Tim is currently very
> much in research mode."

Also noted, and each is logged where it matters rather than acted on here:

- **Alchemy** is endorsed strongly by the Effect team ("I now don't use anything else for deploying
  infrastructure"). ADR-0007 chose Pulumi anyway, for a measured reason — Effect RC churn in Alchemy's
  dependency tree — and that reason is re-checked per release, not assumed. Note #7550 above: Alchemy now
  has a Cloudflare-cluster deployment, so the two are converging.
- **Cloudflare itself uses Effect**, with internal interest in using it more. Relevant only as evidence
  that the Effect + Cloudflare bet is not lonely.
- **A native `Arbitrary` module** is in development to replace `fast-check` (faster, and removes a
  dependency). `PLAN.md` proposes `fast-check` for the rails property test; that test was written
  exhaustively instead (288 enumerated cases), so this is an option rather than a fix.
- **`@effect/atom-react` is not being deprecated** in favour of Foldkit. `apps/console` uses effect-atom;
  nothing to change.
- **No dogmatic project structure is offered by Effect**, by design — which is why ADR-0010's
  slice × role × concept layout is ours to justify and enforce, and why `dep:check` exists.

### `@effect/opentelemetry` and `effect/observability`

**Checked 2026-09-29.** `@effect/opentelemetry@4.0.0-rc.118` exists, with peer dependencies on
`@opentelemetry/sdk-trace-*`, `sdk-metrics`, `sdk-logs` — it is the _bridge to the OTel SDK_.

`effect/observability` is a **built-in subpath of core `effect`**, shipping `Otlp`, `OtlpTracer`,
`OtlpMetrics`, `OtlpLogger`, `OtlpExporter` and `PrometheusMetrics`, with **no dependencies** — OTLP over
plain HTTP. That is what makes it usable on `workerd`, where the Node-targeted OTel SDKs are not. See
`services.md` §6. (Effect is actively maintaining it: #8522, "fix(observability): read OTLP export
response bodies", merged 2026-09-25.)

### Other Effect + Cloudflare packages

**Checked 2026-09-29.** `@effect/sql-d1@0.50.0` and `@effect/sql-sqlite-do@0.30.0` exist but are **v3-era**
— neither is published at `4.0.0-rc.118`, and both target stores this project rejected (D1 per ADR-0002,
DO-SQLite by extension).

---

## Cloudflare

### Workers AI free tier — 10,000 neurons per day

**Measured 2026-09-29**, the hard way. A 99-case eval run failed on all 99 with:

```
{"code":4006,"message":"AiError: you have used up your daily free allocation of 10,000 neurons,
 please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage."}
```

Two things follow, both now in code. A quota 429 is **not** transient and must not be retried
(`LanguageModelWorkersAi` tells the two apart by body, since the status does not) — and AI Gateway's
response cache would have served the repeated identical runs for nothing (`services.md` §7).

**Per-model neuron rates, checked 2026-09-30**, and they say the two gates are in completely different
affordability classes. The free allocation is 10,000 neurons per day and **resets at 00:00 UTC**, on the paid
plan as well as the free one; Workers Paid ($5/month) includes the same allocation and bills $0.011 per 1,000
neurons above it.

| Model this repo uses                       | Rate                                                        |
| ------------------------------------------ | ----------------------------------------------------------- |
| `@cf/baai/bge-m3` (embeddings)             | **1,075** neurons per M input tokens                        |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | **26,668** per M input, **204,805** per M **output** tokens |

- **`evals:retrieval` is effectively free.** The whole fixture corpus is ~2,157 words (~3,200 tokens), so one
  run costs single-digit neurons — under a thousandth of a day's allocation. **The retrieval gate was never
  what exhausted the quota**, and it needs a token rather than a plan.
- **`evals` (the 99-case decision run) costs roughly twice a day's allocation.** Estimated, not measured:
  99 cases at ~4,000 input tokens is ~10,600 neurons, and ~450 output tokens each is ~9,100 more, because
  output on a 70b model is **7.7× the price of input**. So a full scored run cannot fit in the free allocation
  at all, however long one waits — which is why ADR-0008's A/B is blocked on account state.

Three ways out, in increasing cost: AI Gateway response caching (identical re-runs stop costing anything),
a smaller model for the eval loop, or Workers Paid. Only the third also raises the ceiling.

### A completed Cloudflare Workflow step does not re-run — verified by execution

**Measured 2026-09-30** with `apps/worker/test/WorkflowStepMemo.test.ts`, which boots a throwaway Worker in real
`workerd` and asserts it rather than trusting the docs sentence — the same move ADR-0009 made for the
`cloudflare:sockets` driver.

A two-step Workflow where the SECOND step fails on its first attempt and succeeds on its retry:

```
step "one":  executed 1 time     ← had already completed; not re-run
step "two":  executed 2 times    ← failed once on purpose, then succeeded
```

**This is the property `WorkflowEnginePg` exists for.** Its `activityExecute` memo keys on
`(execution_id, name, attempt)`; the Rules of Workflows describe the same mechanism in the same terms —
_"step names act as the 'cache key' in your Workflow"_, _"successfully cached steps do not re-execute"_. So the
298 lines of engine, which carry risk R7 (ours to maintain, no conformance suite), can be replaced by the
platform.

Four rules constrain the migration, all from
<https://developers.cloudflare.com/workflows/build/rules-of-workflows/>:

| Rule                                                                                        | What it means for the decide pipeline                             |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| "Non-serializable resources, like a database connection, should be executed outside" a step | open the connection in `run()`, use it inside steps               |
| A non-stream step return value persists up to **1 MiB** (2^20 bytes)                        | fine for an extraction; a large retrieval goes to R2 by reference |
| Step timeouts **30 minutes or less**; use `waitForEvent` for longer                         | the human pause becomes `waitForEvent`, not a sleep               |
| Step names are the cache key, so they must be **deterministic**                             | `Extract`/`Retrieve`/`Decide`/`Judge` already are                 |

**Default retry behaviour is not documented**, so the probe sets retries explicitly. A test that depended on an
undocumented default would be measuring the wrong thing.

### Workers AI honours OpenAI-compatible `response_format: json_schema`

**Verified by request 2026-09-29** against
`https://api.cloudflare.com/client/v4/accounts/{id}/ai/v1/chat/completions` with
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Structured output works, and `usage` is reported.

Two findings from the same probe:

- **The default `max_tokens` truncates.** Every call in the first real eval returned
  `finish_reason: "length"`, cutting an invoice extraction off mid-string. Now set explicitly to 4096.
- **Constrained decoding emits keys in its own order, not the schema's.** `ProposedDecision` came back
  `citations, outcome, rationale` where the schema declares `outcome, citations, rationale`. This bears
  directly on ADR-0008 and on the measured field-order claim: the ordering is preserved into the schema we
  send, which is the part we control, and what the provider then does with it is not.

### `assets` is inheritable; bindings are not

**Verified 2026-09-29** against wrangler 4.143.0's own `config-schema.json`, by comparing every
env-level key for the "not automatically inherited" note. Exactly **38 keys carry it** — `ai`,
`hyperdrive`, `kv_namespaces`, `queues`, `r2_buckets`, `ratelimits`, `vars`, `vectorize` and the rest of
the bindings — and **`assets` is not among them**; it sits with `main`, `name`, `routes` and
`compatibility_date`. So the top-level-only `assets` block in `wrangler.jsonc` is correct, and repeating
every binding per environment is mandatory. Getting either backwards deploys successfully and fails at
runtime, which is why `bindings:check` exists.

### Cloudflare Pages versus Workers Static Assets

Cloudflare directs new projects to Workers rather than Pages. Corroborating signal from Effect's own
repo: [#6839](https://github.com/Effect-TS/effect/pull/6839) and
[#6840](https://github.com/Effect-TS/effect/pull/6840), "remove cloudflare pages api docs deployment".
ADR-0001's reasons for Static Assets are independent of that and stronger for this product — one origin,
therefore no CORS, no cookie-domain setting, no trusted-origins list. See `services.md` §2.

### Vectorize is absent from both IaC providers

`@pulumi/cloudflare` 6.21.0 ships 1216 resources and none is Vectorize; Cloudflare's Terraform provider
has no `cloudflare_vectorize` either, which is the same gap from the other side since Pulumi's provider is
bridged from Terraform's. Only `wrangler` and the REST API can create one. Recorded in `infra/index.ts`
because it will recur, with `@pulumi/command` as the documented escape hatch.

---

### Durable Objects — free plan, SQLite only, and what keeps one billable

**Checked 2026-09-29**, <https://developers.cloudflare.com/durable-objects/platform/pricing/> and
<https://developers.cloudflare.com/durable-objects/best-practices/websockets/>.

| Fact                                                                                                                                                     | Consequence here                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| DOs are on **Free and Paid**; free is **SQLite backend only**                                                                                            | no plan change needed to build chat                                                                               |
| SQLite GA since 2025-04-07, **10 GB per object**                                                                                                         | storage is not a constraint at our scale                                                                          |
| Free limits: **100,000 requests/day**, **13,000 GB-s/day**, reset 00:00 UTC                                                                              | exceeding one makes further operations of that type **fail**, so a chatty presence feature can take the demo down |
| WebSocket **messages count as requests, at a 1/20 ratio**                                                                                                | a per-keystroke typing indicator is a billing decision, not a UI one                                              |
| Hibernation: clients stay connected while the object leaves memory, and **no duration accrues**                                                          | the reason to use the Hibernation API rather than `accept()`                                                      |
| `accept()` incurs duration **for the whole time the socket is connected**                                                                                | never use it for a room                                                                                           |
| **An outbound `connect()` or outbound WebSocket keeps the object in memory and billable for up to 15 minutes per connection, with no incoming requests** | **the load-bearing one — see below**                                                                              |
| Alarms, incoming requests, `setTimeout`/`setInterval` prevent hibernation                                                                                | no heartbeat timers inside a room                                                                                 |
| `setWebSocketAutoResponse` answers a fixed ping **without waking** hibernating sockets                                                                   | this is how keepalive is done                                                                                     |

**Why the 15-minute rule decides the architecture.** Our Postgres client dials through
`cloudflare:sockets` `connect()` (ADR-0009). A Durable Object that touched the database would therefore
stay in memory and billable for up to 15 minutes **after every write**, which defeats hibernation
entirely — the one property that makes a room affordable. So a room must never hold a `PgClient`. That is
not a style preference; it is the difference between $20 and $400 a month in Cloudflare's own worked
examples (their Example 3 versus Example 4).

### WebSocket keepalive: the runtime answers protocol pings; the browser cannot send them

**Checked 2026-09-30.** Three facts that together decide the design, from
<https://developers.cloudflare.com/durable-objects/best-practices/websockets/>,
<https://developers.cloudflare.com/network/websockets/> and
<https://developers.cloudflare.com/durable-objects/api/state/>.

1. **Cloudflare closes a WebSocket when no data flows in either direction** for a period. The timeout is
   not published and is configurable only for Enterprise. The documented remedy is "implement a client-side
   heartbeat (ping/pong)". Cloudflare also restarts servers when it deploys, which terminates connections —
   so **reconnect logic is mandatory**, not defensive.
2. **The runtime already answers WebSocket _protocol_ ping frames** (RFC 6455 §5.5.2) with pongs, without
   waking a hibernating object, and `webSocketMessage` is not called for control frames.
3. **But a browser cannot send a protocol ping.** The `WebSocket` API exposes no `ping()`; control frames
   are not reachable from JavaScript. So fact 2 does not help a browser client, which is exactly why fact 4
   exists.

4. **`setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))`** answers an
   application-level text `ping` **without waking** the object. Both strings are capped at 2,048
   characters. `getWebSocketAutoResponseTimestamp(ws)` gives the last time a socket auto-responded — which
   is a liveness signal readable without having woken for it.

So: the client sends a text `ping` on a timer, the room answers from the runtime, and the room stays
hibernated. Cloudflare's own best-practices page sets this in the constructor, which is also the only place
it can go for an object that may be reconstructed on any wake.

**Also:** `web_socket_auto_reply_to_close` is default-on for compatibility dates from **2026-04-07**. Ours
is `2026-09-26`, so the runtime completes the close handshake and calling `ws.close()` inside
`webSocketClose` is unnecessary. On an older date, omitting it causes `1006` abnormal closures.

### Durable Objects do not have peers — one name is one instance, and it never moves

**Checked 2026-09-30**, <https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/>
and <https://developers.cloudflare.com/durable-objects/reference/data-location/>.

**There is no cross-node message-passing problem to solve.** A name resolves to exactly one instance
globally, and every client of that room is routed to it from wherever they are. That is the property being
bought. What is paid for it:

| Fact                                                                                                                      | Consequence                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **~500–1,000 req/s** per object for simple pass-through; **~500–750** with JSON parsing; **~200–500** with storage writes | a per-room ceiling. `Required DOs = total req/s ÷ per-DO capacity`                    |
| "**thousands of clients per instance**" over WebSockets                                                                   | a room's connection count is not the binding limit; its message rate is               |
| A single object as a global singleton is a **documented anti-pattern**                                                    | shard on a natural boundary — per room, per org, per document — never one coordinator |
| Created near the **first `get()`**, and **does not relocate** ("dynamic relocation is planned")                           | the first connection decides where a room lives for its whole life                    |
| `locationHint` is honoured **only on the first `get()`**, and is best-effort                                              | it cannot fix a badly-placed existing object                                          |
| `jurisdiction("eu")` constrains where an object **runs and stores**, and is not a hint                                    | the GDPR lever, and it pairs with the `mistral-eu` provider profile                   |

**Two consequences specific to this repo.** Because an object never moves, placement is decided once and
permanently — except that **our rooms store nothing**, so a badly-placed room is fixed by letting it die and
be recreated, which is a dividend of the stateless-fan-out decision nobody planned for. And
`jurisdiction("eu")` is worth defaulting to for EU clients _now_ rather than later, for the same reason: a
later change would apply only to new objects.

### KV cannot back better-auth's `secondaryStorage`, and `better-auth-cloudflare` needs Drizzle

**Checked 2026-09-30.** Two independent reasons, recorded because the advice circulating for
"better-auth on Workers" recommends the opposite.

**KV's 60-second minimum TTL is the shallow problem.** A write with a shorter TTL fails silently, and the
usual workaround is `Math.max(ttl, 60)`. That is not enough here: better-auth's `secondaryStorage` interface
requires `getAndDelete` and `increment` to be **atomic** — the documentation says the latter is needed "so
secondary-storage-backed rate limiting can enforce the limit in one distributed-safe operation". KV is
eventually consistent with no atomic primitives, so two concurrent requests both read N and write N+1, and
rate limiting breaks **silently**. A six-digit OTP is only as strong as its attempt counter. Clamping the TTL
fixes the write and leaves that hole open. See the comment at the end of `BetterAuth.ts`; a Durable Object is
the documented path if session reads ever become a measured bottleneck.

Also worth noting: a 10-second rate-limit window cannot even be _expressed_ with a 60-second floor.

**`better-auth-cloudflare` (zpg6) is `0.3.1` and peers on `@better-auth/drizzle-adapter`.** So adopting it
means adopting Drizzle, which PLAN.md rejects explicitly ("No Drizzle, no ORM" — row schemas are
`Model`/`VariantSchema` so they compose with the domain schemas). Its other selling points are a D1 adapter
(we are on Neon via Hyperdrive) and KV secondary storage (above).

**One piece of its advice we do follow, and one that does not apply.** Instantiating better-auth **per
request** is already how `acquireAuth` works, and the docstring records that capturing it at layer-build time
cost two debugging sessions. Passing `ctx.waitUntil` for background tasks is that package's own
`backgroundTasks.waitUntil` option, not a better-auth core option — `grep waitUntil node_modules/better-auth`
finds nothing relevant in 1.7.6 — so there is no core hook to pass it to.

### A `WebSocket` cannot cross a Durable Object stub boundary

**Verified by execution 2026-09-30**, not from documentation — the docs do not say either way, they simply
always show `stub.fetch(request)`.

Attempting the nicer shape — create the `WebSocketPair` in the Worker and hand the server half to a typed RPC
method, `stub.accept(server, identity)` — fails at runtime:

```
DataCloneError: Could not serialize object of type "WebSocket". This type does not support serialization.
```

**So the pair must be created inside the Durable Object**, which means the room is entered through `fetch`,
which means anything the room needs to know has to ride the request. Cloudflare's own examples put the user
id in the **URL** (`?userId=…&username=…`); we use one header carrying a Schema-encoded value instead, so a
malformed identity is a decode failure at a named line rather than two silent `null`s, and it never appears in
a log. The route rebuilds the header set from the resolved session, so a client cannot supply its own.

Also confirmed while testing: `acceptWebSocket` permits **32,768 connections per object** (CPU and memory may
bind first), and takes up to **10 tags** of 256 characters for filtering `getWebSockets(tag)`.

### `serializeAttachment` is the per-connection store, and it replaces a presence cache

**Checked 2026-09-30**, <https://developers.cloudflare.com/durable-objects/best-practices/websockets/>.

- A value attached with `serializeAttachment` **survives hibernation** for as long as the socket is healthy,
  and is **lost when either side closes**. Max serialised size **16,384 bytes**; structured-clone types.
- `deserializeAttachment()` returns the most recent value, or `null`.
- Larger or longer-lived state is meant to go in the Storage API with its key held as the attachment — which
  we do not need, because a room stores nothing (ADR-0018).

**This is what replaces Redis for presence, and it is better rather than merely simpler.** A presence set in
Redis needs TTL heartbeats because a crashed node cannot delete its own entries, so the list shows ghosts
until a timeout expires and the UI is wrong for that window. Here the viewer list is _derived_ on every read
from `getWebSockets()` plus attachments, so a disconnected viewer is not representable. Note the
corollary: **presence is deliberately not durable**. It is meaningful only while sockets exist, so
persisting it would reintroduce exactly the stale-entry problem.

Cloudflare's own `workers-chat-demo` keeps its sessions in an instance array, which is the pattern to avoid
under hibernation: the array is empty on the next wake.

### Effect v4 has WebSocket RPC, and the upgrade path is `HttpServerRequest.upgrade`

**Checked 2026-09-29** by reading the vendored source at `repos/effect/packages/effect/src/rpc/RpcServer.ts`
(rc.118), which is what the subtree is for.

- `RpcServer.layerProtocolWebsocket({ path })` registers a **GET** route on the current `HttpRouter` that
  upgrades the request and attaches the socket to the RPC protocol.
- It is built on `makeProtocolWithHttpEffectWebsocket`, whose whole body is
  `const socket = yield* Effect.orDie(request.upgrade)`.
- Also present: `layerProtocolSocketServer`, `makeProtocolStdio`, `makeProtocolWorkerRunner`.

**The open question was not whether Effect supports it, but whether `request.upgrade` resolves under
`workerd`**, where an upgrade is performed by returning a 101 response carrying a `webSocket` rather than
by upgrading a request object in place.

**Answered 2026-09-30: it does, and the fallback was taken anyway for a different reason.**

- `HttpServerRequest.upgrade` resolves under real `workerd`. Verified by execution, not by reading:
  `apps/worker/test/Room.test.ts` boots the deployed Worker through `createTestHarness` and asserts a 101
  with a live socket, a welcome frame, fan-out to a second socket, and that a second organization's socket
  receives nothing.
- **The RPC protocol over that socket is what could not be used**, and the reason is a platform rule rather
  than an Effect one: a `WebSocket` cannot cross a Durable Object stub boundary (`DataCloneError`), so the
  room cannot be handed a socket that the API's RPC server accepted. The frames are therefore Schema-encoded
  and pushed from the room — the shape this note predicted as the fallback, reached by a different argument
  (ADR-0020).
- **The upgrade also survives a service binding**, which was the second open question: the console forwards
  `/api/*` to the API with `env.API.fetch(request)` and the 101 comes back with its `webSocket` intact. The
  e2e spec `realtime.spec.ts` opens the socket from a real browser at the console's origin and reads the
  welcome frame, so this is verified end to end rather than at the binding in isolation. The API side must
  return the response with `HttpServerResponse.raw`; `fromWeb` destructures it and drops `webSocket`, which
  is in `AGENTS.md` as a trap.

Related and already recorded above: `RpcServer.layerHttp` mounts a WebSocket when `protocol` is omitted,
which is in `AGENTS.md` as a trap because a plain POST then 404s with nothing in the logs.

## PlanetScale

### Postgres 18.6, pgvector 0.8.5, and a non-superuser `CREATEROLE` role

**Measured 2026-09-29** by `bun run db:verify` against the real database:

```
PostgreSQL 18.6 · pgvector available · connecting as postgres (createrole=true, superuser=false)
dutch text search configuration present · stemming works · to_tsvector provolatile=i
```

That last role line **falsified a reason given in ADR-0014** for removing RLS — the claim rested on the
`pscale_api_*` username visible in Hyperdrive's origin settings, which is a different role. The ADR
records the withdrawal rather than hiding it.

### Latency from this machine

**Measured 2026-09-29**, ten `select 1` round trips inside one established session:

```
local container (localhost:55433)        0.17 – 0.89 ms    median ~0.20 ms
PlanetScale (us-east-5.pg.psdb.cloud)     118 – 126 ms     median ~120 ms
```

600×, and it is distance, not the provider. With 722 transactions per test-suite run, that is 14 seconds
against roughly four minutes. ADR-0015.

---

## How to keep this file honest

Every row says how it was checked and on what date. When a claim here is used to justify something, the
justification should cite the row rather than restate the fact — so that updating one row updates
everything that depends on it.

**The rows most likely to go stale first**, and what changes when they do:

| Row                           | Watch for                       | Then                                                                   |
| ----------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `@effect/platform-cloudflare` | first npm publish               | re-open ADR-0003; our `WorkflowEnginePg` gains an official alternative |
| Workers AI free tier          | a paid plan, or a gateway cache | `bun run evals` can complete a 99-case scored run                      |
| Effect RC churn in Alchemy    | a clean dependency audit        | ADR-0007's reason for Pulumi expires                                   |
| PlanetScale region            | a region near the user          | ADR-0015's arithmetic changes                                          |
