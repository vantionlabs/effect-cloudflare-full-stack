# Services: what we run, where, and why

**The rule.** Cloudflare-native unless there is a written reason not to be. This document is the list of
reasons. Every row either says "Cloudflare" or names the thing Cloudflare does not do.

**The test for an exception**, so the list cannot grow by drift: a non-Cloudflare service has to fail at
least one of — (a) a Cloudflare product exists for the job, (b) it is GA rather than beta, (c) it is
declarable as infrastructure-as-code, (d) adopting it does not lose a property the product depends on. Each
exception below names which one it fails.

Status column, and the distinction matters more than it looks:

| Status                | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| **in use**            | bound, and code reads it                                                   |
| **declared, unwired** | created by Pulumi, bound nowhere, read by nothing — a cost with no benefit |
| **planned**           | in `PLAN.md`, not built                                                    |
| **rejected**          | evaluated and declined, with an ADR                                        |

---

## 1. The inventory

| Service                   | Role                                                         | Where                  | Native? | Status                                               |
| ------------------------- | ------------------------------------------------------------ | ---------------------- | ------- | ---------------------------------------------------- |
| **Workers**               | the whole product: API, RPC, queue consumer, cron            | Cloudflare             | ✅      | in use                                               |
| **Workers Static Assets** | the reviewer console, served from the same Worker            | Cloudflare             | ✅      | in use                                               |
| **R2**                    | source documents (`DOCUMENTS`)                               | Cloudflare             | ✅      | in use                                               |
| **Queues** + DLQ          | the event engine (`EVENTS`)                                  | Cloudflare             | ✅      | in use                                               |
| **Workers AI**            | embeddings (`@cf/baai/bge-m3`) and the LLM (`llama-3.3-70b`) | Cloudflare             | ✅      | in use                                               |
| **Hyperdrive** ×2         | pooling + TLS to Postgres, one cached / one not              | Cloudflare             | ✅      | in use                                               |
| **Workers Observability** | `observability.enabled` — logs and traces in the dashboard   | Cloudflare             | ✅      | on, but nothing is instrumented (§6)                 |
| **Workers KV**            | better-auth session cache                                    | Cloudflare             | ✅      | **planned** — was declared-unwired, now removed (§3) |
| **Durable Objects**       | exact per-API-key quota                                      | Cloudflare             | ✅      | planned                                              |
| **Rate Limiting binding** | coarse flood protection                                      | Cloudflare             | ✅      | planned                                              |
| **AI Gateway**            | caching, retries, cost/limit control in front of the model   | Cloudflare             | ✅      | in use, verified by execution (§7)                   |
| **Analytics Engine**      | custom metrics at SQL                                        | Cloudflare             | ✅      | planned (§6)                                         |
| **PlanetScale Postgres**  | relational + pgvector + Dutch FTS                            | **external**           | ❌      | in use (§4.1)                                        |
| **Postgres in Docker**    | the test database                                            | **local only**         | ❌      | in use (§4.2, ADR-0015)                              |
| **OpenRouter / Mistral**  | non-Workers-AI model profiles                                | **external**           | ❌      | planned (§4.3)                                       |
| **Vectorize**             | vector store                                                 | Cloudflare             | ✅      | **rejected** (ADR-0004)                              |
| **D1**                    | relational store                                             | Cloudflare             | ✅      | **rejected** (ADR-0002)                              |
| **Cloudflare Pages**      | frontend hosting                                             | Cloudflare             | ✅      | **superseded** by Static Assets (§2)                 |
| **Redis**                 | broker, cache, locks, rate limits                            | external               | ❌      | **rejected** — split four ways, all native           |
| **better-auth**           | auth + organizations                                         | library, our Postgres  | n/a     | in use                                               |
| **Pulumi**                | IaC                                                          | external control plane | ❌      | in use — no state or traffic, see §4.4               |

Five bindings today, asserted consistent across environments by `bun run bindings:check`:
`HYPERDRIVE`, `DOCUMENTS`, `EVENTS` (+ consumer), `AI`. Plus `assets`, which is **inheritable** and so
correctly appears only at the top level — verified against wrangler 4.143.0's own schema, where `assets`
is absent from the 38 keys carrying "not automatically inherited" and sits with `main`, `name` and
`routes`. Getting that backwards either way is a silent production break.

---

## 2. The console is on Pages; the API is its own subdomain

Decided 2026-09-29, reversing the single-Worker-with-Assets arrangement. **ADR-0001 carries the reasoning,
the costs and the revisit triggers** — this section is the operational summary.

|                       |                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| console               | Cloudflare **Pages** project, `apps/console/wrangler.jsonc`                                              |
| API                   | the Worker, on `api.<domain>` (routes commented pending a zone)                                          |
| today, with no domain | Pages Function proxies `/api/*` to the Worker over a **service binding**, so the browser sees one origin |

**A correction to an earlier claim in this document.** It previously said Cloudflare "directs new projects to
Workers rather than Pages" and that Static Assets is where the investment goes. That was checked against the
documentation and **is not supported** — the Pages-to-Workers guide is aimed at existing Pages users and
states no deprecation; service bindings and `_routes.json` are documented as supported. The claim was mine,
not Cloudflare's.

What the docs _do_ say is narrower and still relevant: they recommend against **file-based routing via a
`functions/` folder**. Our single Function is a three-line proxy with a deletion trigger (ADR-0001), not an
architecture.

**The three cross-origin settings are one switch.** `CONSOLE_ORIGIN`, `COOKIE_DOMAIN` and `VITE_API_ORIGIN`
are set together or not at all: a deployment with two of the three logs a user in and then silently logs them
out, with nothing in the logs. Absent means same-origin, which is `vite dev` and the proxy shape.

Two facts that decide the design, both verified rather than assumed:

- **Sibling subdomains are the same _site_.** `app.example.com` and `api.example.com` share a registrable
  domain, so `Domain=.example.com` works with `SameSite=Lax` — no third-party-cookie territory. This is why a
  subdomain API is workable where a genuinely cross-site one is not.
- **`*.pages.dev` and `*.workers.dev` are different registrable domains**, so with no zone no `Domain` value
  can bridge them. That is the whole reason the proxy exists.

Verified against the docs while building this: `_routes.json` belongs in the **build output** directory
(`public/` → `dist/` via Vite, so ours lands correctly); Pages supports only `production` and `preview` as
environment names, not the Worker's `staging`; and `services` is non-inheritable on Pages too.

**Also fixed while checking:** `observability.enabled` enables **logs only** — traces need
`observability.traces.enabled` separately. Both Workers had logs on and traces off, which mattered because
`Activity`, `effect/sql` and `LanguageModel` all create spans, so the decide pipeline was fully instrumented
and reporting nothing to Cloudflare.

## 3. KV: declared and unwired, then removed, now wired for a different job

`infra/index.ts` created a `WorkersKvNamespace` and exported `kvNamespaceId`. There was **no
`kv_namespaces` block in `wrangler.jsonc`**, and nothing read one — so the plan described a session cache
that did not exist while every better-auth lookup went to Postgres. **Each file was internally consistent,
which is exactly why nothing objected.**

Removed rather than papered over (`wrangler kv namespace list` returned `[]`, so nothing was destroyed), and
the gap is now closed by a check rather than by this paragraph: `bindings:check` asserts every Pulumi
resource kind is bound and every binding has a resource or a stated reason, **in both directions**, both
negative-tested.

**Now back, for a job KV can actually do.** Sessions are still the wrong thing to put here, for a specific
reason rather than a cautious one: better-auth's `secondaryStorage` requires atomic `getAndDelete` and
`increment`, KV has neither, and backing it with KV would **silently break rate limiting** — a 6-digit OTP
is only as strong as its attempt counter.

What it holds instead is **parsed document text, keyed by document id AND parser version**. That key is the
whole argument: a parser version _defines_ the verbatim contract, so a bump is a different key and cannot
serve text the current parser would not produce (R6). Every workflow redelivery otherwise repeats an R2 GET
plus a parse, on the hottest path in the product.

The rule for anything added later is in `shared/domain/Cache/Cache.ts`: **the key must make staleness
impossible.** Not unlikely — impossible, because there is no invalidation. That file also carries the table
of what therefore may _not_ be cached — sessions, the armed auto-approve rule, a member's role, the review
queue — with the specific reason for each.

## 3.1 The pipeline was not wired into the Worker — FIXED 2026-09-29

Found while writing §1, by trying to verify my own "in use" claim for Workers AI. It is not a documentation
slip — it is the largest gap in the project, and the code says so itself. From `apps/worker/src/Main.ts`:

> _"The work each message triggers is not wired yet: `document.decide` runs the decide pipeline at step 9
> … Until then a message is read, recorded and acked, which is enough to prove the plumbing and the batch
> semantics without pretending the pipeline is connected."_

Measured, not inferred:

| Claim                                   | Evidence                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| The Worker never reads the `AI` binding | `Env` in `platform/Bindings.ts` declares `HYPERDRIVE`, `DOCUMENTS`, `EVENTS`, `VERSION` — **no `AI`** |
| No model layer is provided              | no `LanguageModel` or `EmbeddingModel` in any `apps/worker/src` layer                                 |
| The queue consumer does no work         | `queue` passes `() => Effect.succeed({ _tag: "Done" })`, so every message is acked unprocessed        |
| Nothing dispatches events               | `ConsumeEvent` has **no caller outside tests**                                                        |
| There is no cron                        | no `scheduled` export and no `triggers` in `wrangler.jsonc`, so `ReconcileStuckExecutions` never runs |

So: **the deployed Worker cannot decide a document.** It serves health, identity, intake and the read side
of decisions. Extraction, retrieval, the rails, the workflow engine and the execute path are all built,
all tested against real Postgres, and reachable only from tests and `evals/`.

**Why this was easy to miss, and worth saying plainly.** Every one of steps 5 through 9 is genuinely
finished _as a module_, with real tests — 212 of them. `bindings:check` passes because `ai` is declared
consistently across environments; it has no way to know nothing reads it. `dep:check` passes because the
boundaries are correct. The plan's Progress table said "done" for steps 7, 8 and 9, and that was true of
the work those steps describe. Nothing was overstated deliberately; the gap is _between_ the steps, which
is exactly where a build order stops looking.

**Wired on 2026-09-29.** What it took, and one thing it exposed:

| Change                                                                          | Why                                                                                                                                       |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `AI` added to the `Env` interface                                               | it was in `wrangler.jsonc` and unreachable from TypeScript                                                                                |
| `EmbedderWorkersAiBinding` + `LanguageModelWorkersAiBinding` in `ServicesLayer` | the **binding** transport, so the Worker makes no HTTP call and holds no token                                                            |
| `platform/DispatchEvent.ts`                                                     | maps `document.decide` → the workflow and `decision.execute` → `ExecuteDecision`; provides the engine and the policy port **per message** |
| `IngestUpload` now emits `document.decide`                                      | the last link — the pipeline was wired and nothing fired it. Transactional documents only; a policy document is corpus, not a case        |
| `scopedForOrg` finally has callers                                              | it had **zero**, same pattern as the KV gap                                                                                               |
| `CurrentOrg` is now the tenancy requirement                                     | see below — this was the real blocker                                                                                                     |
| `placement: { mode: "smart" }`                                                  | motivated by ADR-0015's 120 ms measurement: a decide workflow is many round trips to one origin                                           |

**The blocker was an identity mismatch, not missing plumbing.** `WorkflowEnginePg` required `CurrentUser`,
and a queue consumer has no user — so the pipeline was _unreachable by type_, which is why it was never
noticed as broken. The fix inverts which tag is the default: **`CurrentOrg` is the tenancy requirement, and
`CurrentUser` is only for code that needs the person** (recording `approved_by`, reading "my" queue).
Requiring the stronger tag where the weaker would do is now understood as a real cost — it makes a use case
unreachable from a queue or a cron.

`ConsumeEvent` became **privileged** as a result: it resolves the tenant from the event row with an unscoped
point lookup, so an ambient organization has no effect on it. That is correct for a consumer and unsafe on a
request path, so `dep:check` allows exactly one importer, and the test that used to assert the opposite now
asserts the new semantics explicitly. Both were negative-tested.

**Still not wired**, and neither is a one-liner:

- ~~**The cron.**~~ **Done.** `Main.ts` has a `scheduled` export, `wrangler.jsonc` has
  `"crons": ["*/5 * * * *"]` at both levels, and it now runs BOTH jobs: `SweepEnqueueGap` (the enqueue-gap
  recovery record) and `ReportStuckWork` (2026-10-01), the stuck-claim report `ExecutionTable.ts` promised
  and ADR-0013 requires. The report touches nothing — an ambiguous `pending` may mean the adapter call
  succeeded and only the recording write was lost, so "recovering" one pays a supplier twice.

  The flip gave it a second job the plan never anticipated: an `events` row left `processing` with a
  `workflow_instance_id` when an instance dies without recording. Nothing else notices that state.
- **A second vertical.** `IngestUpload` hardcodes `invoice`, named as `INVOICE_VERTICAL` so the question
  "where is the vertical chosen?" has one answer when a second arrives.

**The original list, kept for the record:**

1. `AI` on the `Env` interface, and `LanguageModelWorkersAiBinding` + `EmbedderWorkersAiBinding` in
   `ServicesLayer`. Both adapters already have a binding transport for this reason.
2. A dispatch: `document.decide → DecideDocumentWorkflow.execute`, `decision.execute → ExecuteDecision`,
   passed to `consumeBatch` as the `work` callback instead of the current constant.
3. ~~`WorkflowEnginePg` and `PolicySearchLive` in the queue-side layer.~~ Both gone as of 2026-09-30: the
   queue starts a Workflow instance, so it needs no engine, no policy port and no pipeline layer.
4. A `scheduled` export plus `triggers.crons`, for the enqueue-gap sweeper and the stuck-claim report —
   both of which the plan describes as the recovery record for failure modes that have no transaction.
5. The intake path emitting `document.decide` on upload.

**This outranks everything in §9's ordering.** AI Gateway, telemetry and API keys are all improvements to a
path that does not yet run in production. Wiring this is what turns a set of tested modules into the
product, and it is the shortest route to the demo the repo is meant to be.

## 4. What is not on Cloudflare, and why

### 4.1 PlanetScale Postgres — fails test (a): no Cloudflare product does this job

This is the one substantive exception, and it is deliberate (ADR-0002). The store has to do **three things
at once**: relational integrity, vector similarity, and real Dutch full-text search — over the same rows,
in one transaction, because the product's claim is that a citation and the vector that found it cannot
diverge.

- **D1 cannot.** It was rejected on a corrected fact: D1 routes _all_ queries, reads included, to one
  primary instance, so the "in-colo reads" advantage did not exist. It has no vectors, and no Dutch
  stemmer — you would hand-roll Snowball.
- **D1 + Vectorize cannot either**, and this is the deeper reason. Two stores means partial ingest,
  `embedded_at IS NULL` handling, a reconciliation query and an ordering rule — a bad failure class for a
  product whose entire claim is auditability. One store makes divergence unrepresentable.
- **Postgres gives all three free**: pgvector 0.8.5 with HNSW, `to_tsvector('dutch', …)` with real
  Snowball stemming, and RRF fusion of both halves **in one SQL function** — transactionally consistent,
  with the tenant filter and corpus separation in the same `WHERE`.

**It is as close to native as it gets without being native.** PlanetScale is created through the
Cloudflare partnership flow, so it is a line item on the Cloudflare invoice and Cloudflare credits apply;
it is reached through **Hyperdrive**, which is native, keeps the pool warm outside the Worker and
terminates TLS at the edge (p90 4 ms). The Worker holds no credentials — that is the point of the binding.

The honest costs: PlanetScale **bills daily from creation**, so there is no scale-to-zero (R13); and the
cluster itself is the one resource Pulumi does not manage, because no provider exists (§4.4).

**Revisit when** D1 ships vectors and a stemmer, or a Cloudflare-native Postgres appears. Not before.

### 4.2 Postgres in Docker — local only, and measured (ADR-0015)

The test database. From this machine: **~0.20 ms per round trip local, ~120 ms to PlanetScale — 600×**,
because `us-east-5` is across an ocean and Hyperdrive does nothing for a laptop. The suite issues **722
transactions**, so 14 seconds becomes ~4 minutes; and it migrates and truncates, so two runs race.

Pinned `pgvector/pgvector:0.8.5-pg18` — same major and same pgvector as production. Runs nowhere but a
developer machine and CI.

### 4.3 Model providers beyond Workers AI — fails test (d) for EU work

Workers AI is native and is what the code uses today. Two reasons other providers stay in the plan:

- **EU data residency.** A Dutch client's requirement is met by going **direct to Mistral** (French
  company, EU processing, DPA, ZDR on Scale for stateless endpoints only). Routing Mistral _through_
  OpenRouter would transit a US intermediary and defeat the argument — which is why these are two
  profiles, not one.
- **Scanned PDFs.** Mistral OCR 4.1 gives bounding boxes and per-block confidence. The boxes let the
  reviewer see _where on the page_ a `source_span` came from, and block confidence is a natural rail input.

The ports (`LanguageModel`, `EmbeddingModel`, `DocumentParser`) never change; the profile does. Workers AI
remains the default, and **AI Gateway (§5) is how a non-Cloudflare provider comes back under Cloudflare
control** — so this exception is narrower than it looks.

### 4.4 Pulumi — an external control plane, holding no state and serving no traffic

Not a runtime service: it never sees a request or a row. Chosen over Alchemy (pre-1.0, and blocked on
Effect RC churn) and over `wrangler` scripts, because it brings real state and a `preview` that says what
would change.

It has one documented gap worth keeping: `@pulumi/cloudflare` 6.21.0 ships 1216 resources and **none is
Vectorize** — nor does Cloudflare's Terraform provider have it, which is the same gap from the other side
since Pulumi's is bridged from Terraform's. The escape hatch is `@pulumi/command` shelling to wrangler.
Recorded because it will recur.

### 4.5 What needs no service at all

Worth stating, because it is the shape to aim for: **Workers AI required no infrastructure change
whatsoever.** The `ai` binding in `wrangler.jsonc` is its entire declaration. No account id, no token, no
Pulumi resource — the binding _is_ the authorisation.

---

## 5. The public API: keys, caching, rate limiting

The product is the API (a PHP/Laravel consumer is the second client). What exists, and what does not:

| Concern                                   | State                                                               |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Versioned `HttpApi` + OpenAPI/Scalar docs | **in use** — `packages/api/v1`, frozen snake_case wire schema       |
| Effect RPC alongside HTTP                 | **in use** — `V1.rpc.ts`, same groups                               |
| Cookie session auth                       | **in use** — better-auth, organization-scoped                       |
| **API keys**                              | **not built**                                                       |
| **Rate limiting / quota**                 | **not built**                                                       |
| **Response caching**                      | **not built** — one `Etag.layerWeak` for assets, nothing on the API |
| Async semantics (202 + poll)              | in use for intake                                                   |
| **Webhooks out**                          | not built — `intakes.source` anticipates inbound only               |

### API keys — the plan's shape, unbuilt

`X-API-Key`, SHA-256 hashed at rest, shown once, resolving to the **same `CurrentUser`** as a cookie so
there is one authorization seam and not two. CORS returns for the API-key path only. This is the gate for
everything else in this section: a quota is per key, and a cache key must include the tenant.

### Caching — where the tenant trap is

Cloudflare gives three layers, and they are not interchangeable:

1. **`caches.default`** (Cache API, in the Worker) — the only one that can see an API key, therefore the
   only one safe for per-tenant data.
2. **Cache Rules** (zone level, before the Worker) — cheapest, and correct **only** for genuinely public
   responses: OpenAPI JSON, the Scalar page, static assets.
3. **Hyperdrive's own cache** — already in use for the policy corpus, deliberately disabled for
   everything transactional (R3).

**The trap, and it is the one that matters:** a cache key that omits the organisation serves one tenant's
decision queue to another. It is a cross-tenant data leak wearing the costume of a performance win, and
it would pass every test that does not specifically look for it. So: the cache key must include the
resolved `orgId`, never the raw key (which would make the cache per-key instead of per-tenant and destroy
the hit rate), and `Vary` must be set. Given that, very little of this API is cacheable — the queue and
decision detail are transactional by nature. The honest candidates are the policy corpus, `GET
/decisions/{id}` for a settled decision (immutable once terminal), and the OpenAPI document.

### Rate limiting — three answers, because one does not fit (already analysed in `PLAN.md`)

- **Coarse flood protection** → the native Rate Limiting binding (GA, free). Note it is per-colo,
  _"permissive, eventually consistent, and intentionally designed to not be used as an accurate
  accounting system"_, with periods restricted to 10 s or 60 s. Also `ratelimits` **is** non-inheritable,
  so it must be repeated per environment.
- **Contractual quota** ("1,000/hour") → **a Durable Object per key.** Single-threaded, so the count is
  exact without locks, with an alarm to reset. 10/60 s cannot express an hourly window, and the binding is
  explicitly not for accounting. **This is the one place a DO genuinely earns its keep.**
- **OTP / sign-in attempts** → **neither.** Per-colo is unsafe here: 5 attempts per colo across ~300 colos
  is ~1,500 guesses at a 6-digit code. Attempt counts belong on the verification row in Postgres, where
  better-auth already keeps them.

---

## 6. Telemetry — wired 2026-09-29

The measurement that motivated this was: **0 spans, 0 metrics, 0 Analytics Engine bindings, 4 log calls.**
One of those four numbers turned out to be wrong in an interesting way.

### The spans already existed

`Activity` wraps every workflow step in `Effect.withSpan`. `effect/sql` traces queries. `effect/ai`'s
`LanguageModel` traces model calls. `RpcServer` traces requests. So the decide pipeline was **fully
instrumented and the spans were being discarded**, because no `Tracer` was provided. That is a drain problem,
not an instrumentation problem, and it changes the size of the job entirely.

`platform/TelemetryOtlp.ts` is the drain: `Otlp.layer` from **`effect/observability`**, a subpath of core
`effect` with _no dependencies_, speaking OTLP over plain HTTP — which is what makes it work on `workerd`
where the Node-targeted `@opentelemetry/sdk-trace-*` packages do not. JSON rather than protobuf: every
backend accepts it, it is readable in a network trace when the export itself is what is broken, and it keeps
a protobuf encoder out of the bundle.

`@effect/opentelemetry@4.0.0-rc.118` also exists and is the wrong tool here — it bridges to the OTel SDK so
OTel _instrumentation libraries_ can be reused, and a Worker has none.

Off unless `OTLP_ENDPOINT` is set. A Worker that refused to start without an observability backend would
make telemetry an availability dependency.

### What spans cannot report, and Analytics Engine now does

Latency and causality are not what this product is judged on. **How often it refuses, and whether its
refusals are grounded** is — and that is a rate over decisions, not a duration over calls.

`Telemetry` is a port in `decision/domain/Telemetry` with exactly one method, `decision(...)`, taking a typed
observation. Not a generic `counter(name).increment()`: a generic API means the question "what does this
system report?" is answered by grepping call sites instead of reading one interface.

It lives in `decision` and not `shared` because `DecisionObservation` needs `Outcome`, which is the decision
slice's vocabulary — putting it in `shared` would invert the dependency direction, and `dep:check` counts
that as a slice-isolation violation. It was written in the wrong place first.

`platform/TelemetryAnalytics.ts` maps it to `writeDataPoint`. **The three arrays are positional and their
order is the schema** — there are no field names on the wire, so a query reads `blob1`/`double2` and
inserting a value in the middle silently reinterprets every historical row. Append only; the mapping comment
is the only documentation a future query author gets.

Reported per decision: vertical, outcome, rail categories, retrieval mode, grounded, citation count, tokens,
duration, and **`replayed`**. That last one matters: a replay returned early and silently before, so
redeliveries would have drifted every rate — the denominator counting messages while the numerator counted
decisions.

### The one rule for reading these (R1)

**A falling `needsHuman` rate is an alarm, not a win.** Honest behaviour under poor retrieval is to escalate
everything — correct, and indistinguishable from failure. The mirror is worse: weaker grounding _lowers_
escalation by shipping ungrounded decisions. So it is never reported alone; it is read beside `grounded`, and
both beside the per-rail fire rates that say which mechanism acted. `citations: 0` is the sharpest single
signal — a decision with nothing to point at cannot be audited whatever its outcome says.

### Still not instrumented

- **`HttpApiBuilder` creates no spans** (checked; `RpcServer` does). A request span would have to be added at
  the handler edge, which is a natural job for `Serve.ts` now that every handler goes through it.
- **Queue depth, DLQ counts, and stuck `pending` executions.** These are the recovery signals for the two
  failure modes that have no transaction, and they need the cron that does not exist yet.
- **Web Analytics / RUM** for the console.

## 7. AI Gateway — in use, and now measured

**Corrected three times in one day, and the third correction is the one to trust because it is the only one
made against the account rather than against a file.**

The sequence is worth keeping, because each wrong answer had a different cause:

1. "Not used" — **stale**. Every model adapter routes through a gateway, and the embedder joined them on
   2026-09-30.
2. "Already adopted" — **overstated**, said before checking anything.
3. "The gateway does not exist; the configuration names a resource nobody created" — **wrong, and
   confidently so.** I read _"(no gateway exists on the account yet)"_ in a code comment in
   `LanguageModelWorkersAi.ts`, combined it with "Pulumi is frozen", and reported the conclusion as a
   finding. Both inputs were fine; the inference was not, and I had no way to check when I made it.

**What the account actually says** (checked 2026-09-30 via the `cf-ai-gateway` MCP server):

| Layer             | State                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The gateways      | ✅ **three, one per environment** as of 2026-10-01: `effect-ai-ai-dev` (created 2026-09-29 by Pulumi) plus `-staging` and `-production`, created through the Cloudflare MCP under ADR-0007's freeze. All carry `cache_ttl: 3600`, `collect_logs: true`, 600/60s sliding — `infra/index.ts`'s declared settings, and `name("ai")` yields exactly these ids per stack, so a later `pulumi import` finds no drift |
| The adapters      | ✅ all four paths route — chat by gateway hostname, embeddings by `cf-aig-gateway-id` header, both bindings by `{ gateway: { id } }` run option                                                                                                                                                                                                                                                                |
| The configuration | ✅ each environment names its OWN gateway. Until 2026-10-01 every level named `effect-ai-ai-dev`, so production inference would have logged through a gateway called dev — one cache and one analytics view shared with staging, and no production-only spend limit expressible                                                                                                                                |
| Verified by       | ✅ **execution**, not assertion — 63 log entries, and the before/after below                                                                                                                                                                                                                                                                                                                                   |

**The embedder fix is measured rather than argued.** The gateway's logs show only
`@cf/meta/llama-3.3-70b-instruct-fp8-fast` from 14:42 UTC onward, and `@cf/baai/bge-m3` appears for the first
time at 17:00 UTC — after the embedder commit at 16:36 UTC. Before the fix the embedder was invisible to the
gateway; after it, it is not. That is the whole claim, and it needed no argument once the logs were readable.

**And the cache works, which was the point.** Cached entries report `cost: 0` and `latency: 0`, including for
`bge-m3`. An uncached `llama-3.3-70b` call at 888 input tokens cost **30.2 neurons**; the cached repeats cost
nothing. That is the mechanism that makes a re-run of the same eval fixtures free against a 10,000-neuron
daily allocation.

**The lesson is not about AI Gateway.** `AGENTS.md` says to put an external fact in `docs/references.md` with
the date it was checked _"rather than asserting a version or a provider behaviour inline, so a stale claim can
be told from a wrong one"_. The inline comment I trusted was a stale claim, and because it was inline there
was nothing to date it against — so I could not tell. The comments are corrected and the fact now has a dated
row.

**`bindings-check`'s blind spot is still real**, and this episode is not evidence against it: it compares
declarations against declarations, so it would pass just as happily if the gateway _had_ been absent. What
changed is only that this particular resource turns out to exist.

It sits in front of any model provider, Workers AI included, and gives: **caching** of identical requests,
**rate limiting**, **retries and fallback** to another provider, **per-request logging with tokens and
cost**, and **spend limits**.

Four reasons it belongs here specifically:

1. **It would have prevented this week's blocker.** The 99-case eval run failed on all 99 with Workers AI
   code 4006 — the free tier's 10,000 daily neurons, spent by _repeated runs of the same fixtures_. Those
   are identical prompts at `temperature: 0`. A gateway cache would have served the repeats for nothing.
2. **Cost per decision becomes an observed number** rather than something the eval harness alone knows.
3. **It brings the non-Cloudflare providers (§4.3) back under Cloudflare control** — one place for keys,
   limits, logs and fallback, whoever is serving the tokens. This is the single biggest lever on "as much
   on Cloudflare as possible", because it converts an exception into a managed edge.
4. **Fallback is a product property, not an optimisation.** When the model is down, the honest behaviour is
   to escalate; a second provider means escalating less often for reasons that have nothing to do with the
   invoice.

One caution: caching model responses is only safe where the prompt fully determines the answer. It does
here — the prompt carries the extracted fields and the retrieved clauses — but a cached _decision_ must
never outlive a change to the policy corpus, so the corpus version belongs in the cache key.

---

## 8. `@effect/platform-cloudflare` — not published, but being built right now

Checked directly, since the answer decides real work:

```
@effect/platform-cloudflare           404
@effect/platform-cloudflare-workers   404
@effect/cloudflare                    404
@effect/cloudflare-workers            404
```

Nothing is installable today. **But it exists and is in active development**, in
[Effect-TS/effect#7322](https://github.com/Effect-TS/effect/pull/7322) — open, not a draft, created
2026-08-18, +14,344 lines, with slices already merged (#7345, #7346, #7550, #7927). Full detail and dates
in `references.md`; the two things that matter here:

**What it will give us.** `CloudflareWorkflowEngine.ts`, with its own storage, runtime, registry and wire,
plus unit and integration tests — **an official `WorkflowEngine` backed by Durable Objects.**

**That mattered more before 2026-09-30 than it does now.** It was the alternative to our hand-written
`WorkflowEnginePg`; that engine is deleted and the decide pipeline runs on Cloudflare Workflows directly
(ADR-0024), so an official `effect/workflow` engine would now be a way to get the typed channels back
ACROSS step boundaries rather than a way to avoid maintaining an engine. Still worth watching — ADR-0024's
last revisit trigger names it — but it is no longer load-bearing.

**What it will NOT give us**, quoting the PR: _"cluster plus the minimum Worker/DO glue; **no
HttpServer/Crypto/FS parity**"_. This is the more useful half of the answer. It means the Cloudflare
integration we hand-rolled is not about to be replaced and was not a case of missing an available
package — there was nothing to miss, and for the HTTP and Postgres pieces there still will not be.

So the integration is ours, and deliberately thin:

| Need                               | What we do                                                                                           | Affected by #7322?        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------- |
| Postgres over `cloudflare:sockets` | our own `Duplex` into `PgClient`'s public `stream` option (ADR-0009)                                 | no — out of scope         |
| HTTP serving                       | `HttpRouter.toWebHandler` from core `effect/http` — web-standard, no platform package                | no — out of scope         |
| Bindings as services               | `Context.Service` for `Bindings`; `RequestCtx` separate because `ExecutionContext` is per-invocation | no                        |
| R2 / Queues / AI                   | structural interfaces in `modules`, so Cloudflare's ambient types stay out of the domain             | no                        |
| Durable workflow execution         | Cloudflare Workflows directly, via a `WorkflowEntrypoint` (ADR-0024)                                 | **yes — this is the one** |

The two Cloudflare-adjacent Effect packages that do exist are `@effect/sql-d1` (0.50.0) and
`@effect/sql-sqlite-do` (0.30.0) — both **v3-era**, neither at `4.0.0-rc.118`, and both for stores this
project rejected.

**`@effect/platform-bun` must never appear in `apps/worker` or any `*/server/*`** — the deployed Worker
runs on `workerd`, not Bun. Bun's reach is the toolchain, `scripts/` and `evals/`. `dep:check` asserts it.

## 9. Gap analysis against the demo ambition

The goal stated: _a full demo of AI engineering — agents, RAG, evals, embeddings — on Effect + Cloudflare,
full stack, with B2B SaaS basics._ Honest scoring.

### AI engineering

| Capability                     | State                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Document parsing**           | ✅ **tier 2 landed 2026-09-30**: `@firecrawl/anydoc-wasm` in-Worker for 12 formats (docx, pdf, xlsx, rtf, epub, …), verified in real `workerd` — ~1 ms init, ~16 ms a `.docx`. Tier 1 (`.md`/`.txt`) still handles text; **tier 3 (OCR) is built and OFF by default** — Mistral, EU-resident, stateless endpoint only, model pinned; absent means a scanned PDF is refused rather than read. Not verified by execution: no key on this account |
| **Embeddings**                 | ✅ Workers AI `bge-m3`, 1024d matching the column; swappable port; dimension mismatch refused before storage                                                                                                                                                                                                                                                                                                                                   |
| **RAG**                        | ✅ and unusually strong — heading-aware chunking, contextual prefixes, pgvector HNSW + Dutch FTS, **RRF fused in one SQL function**, corpus separation enforced inside the function                                                                                                                                                                                                                                                            |
| **Retrieval evals**            | ✅ **run and passing, 2026-09-30**: lexical 84.6% / hybrid 100.0% at k=3 on the gold set, against gates of 75% / 90%. Beats the LangChain splitter at every size and badly above 150. Costs ~0.05 neurons, so the "blocked on quota" note was about the DECISION eval                                                                                                                                                                          |
| **Rails / guardrails**         | ✅ four rails behind an unconstructible brand — a decision _cannot compile_ without passing them                                                                                                                                                                                                                                                                                                                                               |
| **Model-free gate**            | ✅ `evals:rule` — assumes the model is maximally wrong; found 190/300 released, now 1/300 (ADR-0016)                                                                                                                                                                                                                                                                                                                                           |
| **End-to-end evals**           | ⚠️ built, genuinely blocked on model quota — ~47 neurons an uncached call × several calls × 99 cases exceeds the 10,000/day allocation. Real corpus with distractors, scored against docket's 33/99                                                                                                                                                                                                                                             |
| **Durable execution**          | ✅ **Cloudflare Workflows** as of 2026-09-30, replacing the 298-line hand-written engine (risk R7 retired). Five steps, memo proven in real `workerd`, terminal failures mapped to `NonRetryableError`, and the queue hands off rather than running the pipeline inline                                                                                                                                                                        |
| **Structured output**          | ✅ native JSON mode with a provider-side JSON schema, measured field ordering                                                                                                                                                                                                                                                                                                                                                                  |
| **AI Gateway**                 | ✅ in use and **verified by execution** — every adapter routes (embeddings joined 2026-09-30, provable from the logs' before/after), the gateway carries `cache_ttl: 3600`, and cached calls report `cost: 0`. §7                                                                                                                                                                                                                              |
| **Agents (tool-calling loop)** | ✅ **built 2026-09-29, this row was stale.** `AskCorpus` runs a real `Tool.make("search_policy")` loop under `AgentModel`, streams progress, and **refuses an answer whose citation it cannot verify**. The claim below about `toolChoice: "none"` is true only of the DECIDE adapter, which is deliberate                                                                                                                                     |
| **Stateful agents**            | ⚠️ `AssistantAgent` on the Agents SDK (2026-09-30): durable per-conversation state, an org-scoped Durable Object name enforced by the port's `CurrentOrg` requirement, reachable over RPC. No resumable streaming and no console surface yet                                                                                                                                                                                                    |
| **Reranking**                  | ❌ RRF only; no cross-encoder                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Judge / LLM-as-critic**      | ⚠️ `Judge` is named in the plan's activity list; the rails do the work today                                                                                                                                                                                                                                                                                                                                                                    |

**On agents, plainly** — written as a proposal, and it is now what exists, so it is kept as the statement of
why the shape is what it is: a tool-calling loop is the honest addition, and the natural one is the reviewer
asking questions of the corpus ("which clause covers a supplier not on the list?") with retrieval as a tool.
It is additive and does not touch the decide path: the whole argument for the decide pipeline is that it is
_not_ a loop with unbounded authority. Both halves held. `AskCorpus` is RPC-only rather than part of the
frozen v1 HTTP contract, and the rails apply to it too — an ungrounded answer is refused rather than
returned with a caveat, which is the same refusal the pipeline makes, reached by a different route.

The stateful half landed on 2026-09-30, on the Agents SDK: `AssistantAgent` keeps a reviewer's conversation
in its own Durable Object, and `Assistant.ask` answers through the same `AskCorpus` loop and records the
turn — including refusals, which are recorded and then re-raised so a refusal cannot become an
answer-shaped thing with no answer in it.

Three rules bound it, and ADR-0025 carries the reasoning:

- **`Agent`, never `AIChatAgent`** — the latter requires the Vercel AI SDK, which would put a second model
  abstraction beside `effect/ai` (ADR-0023).
- **The agent never touches the database.** For a room that rule was cost; for an agent the stronger reason
  is tenancy, since a Durable Object cannot validate the identity it is handed and the corpus is
  tenant-scoped. `dep:check` covers both.
- **Waiting is not the agent's job.** ADR-0024 assigns waiting on a human to Workflows' `waitForEvent`, so
  there is no `schedule()` call here — the tracker issue claimed it as the headline win and was corrected.

Still missing: resumable streaming and a console surface. `.scratch/ai-stack/issues/04` tracks both.

### B2B SaaS basics

| Capability                              | State                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth, organizations, roles, invitations | ✅ better-auth + organization plugin                                                                                                                                                              |
| Multi-tenant isolation                  | ✅ `Db.scoped` seam + a static check that every tenant-table statement filters `organization_id` (ADR-0014)                                                                                       |
| Audit trail                             | ✅ genuinely good — `events`, `decision_citations`, `executions`, `rails_fired` all queryable                                                                                                     |
| Public versioned API + docs             | ✅                                                                                                                                                                                                |
| **API keys**                            | ✅ better-auth's `api-key` plugin, `X-API-Key` resolving to the SAME `CurrentUser` as the cookie through one declared security scheme (ADR-0022). Row was stale                                   |
| **Quota / rate limits**                 | ❌ the per-key Durable Object is still unbuilt — the one place the plan says a DO "genuinely earns its keep", since the CF rate-limit binding is per-colo and explicitly not an accounting system |
| **Billing / metering**                  | ❌ nothing. No Stripe, no usage counter                                                                                                                                                           |
| **Outbound webhooks**                   | ❌ inbound anticipated only; needs an outbox + HMAC signing + retries                                                                                                                             |
| **Admin / back-office**                 | ❌                                                                                                                                                                                                |
| **Email**                               | ❌ no transactional email (invitations, verification)                                                                                                                                             |
| **Session cache**                       | ⚠️ §3                                                                                                                                                                                              |
| **Telemetry**                           | ✅ `TelemetryOtlp` (spans) + `TelemetryAnalytics` (the product's own rates), both optional so telemetry is never an availability dependency. Row was stale                                        |
| **Frontend**                            | ⚠️ built, and now exercised by the Playwright suite in `e2e/` against a real Worker — but never against a DEPLOYED origin, because Deploy is red on a missing `CLOUDFLARE_API_TOKEN`               |

### The shortest path to the stated demo

Ordered by what unblocks the most, not by size:

0. **Wire the pipeline into the Worker (§3.1).** Not in the original ordering because I had not yet
   discovered it. Everything below is an improvement to a path production cannot run; this is the one that
   makes the product exist. Mostly composition, not new logic.
1. ~~**AI Gateway**~~ — **done.** All four adapter paths route as of 2026-09-30, the embedder last and it is
   the most-repeated call. The gateway itself has existed since 2026-09-29, which I got wrong twice before
   reading the account; §7 has the sequence. Cached calls report `cost: 0`, which is the eval-quota
   mechanism this item existed for.
2. **Telemetry** — `effect/observability` + Analytics Engine, product metrics before platform ones. An AI
   engineering demo with no observability is not one.
3. **API keys → quota (DO) → caching**, in that order. Each needs the previous: a quota is per key, and a
   cache key needs the resolved tenant.
4. **Run the console against `wrangler dev`.** It is built and unproven; this is hours, not days.
5. **Wire or delete KV.**
6. ~~An agent surface~~ — **done 2026-09-29.** `policy/use-cases/Ask/AskCorpus.ts`, exposed as RPC only
   (not the frozen v1 HTTP contract: an agent's prompt, tools and step bound are the least stable thing in
   the system). Uses `@effect/ai-openai` over Workers AI's OpenAI-compatible endpoint rather than the
   hand-rolled adapter, because tool calling should not be hand-rolled.
7. **Billing/metering and outbound webhooks** — the remaining B2B basics, and the least interesting
   technically.

---

## Keeping this honest

This file is a claim about a running system, so it decays. Four checks assert parts of it, and all run in
`bun run preflight`:

| Check            | Asserts                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bindings:check` | bindings match across all environments (non-inheritable keys)                                                                       |
| `bindings:check` | every Pulumi resource kind is bound, and every binding has a resource or a stated reason — **added because §3 survived without it** |
| `dep:check`      | 502 boundary rules, including that `@effect/platform-bun` never reaches the Worker                                                  |
| `infra:preview`  | what Pulumi would change (read-only)                                                                                                |

What is still unasserted, and therefore still decays: the **statuses** in §1. "In use" versus "planned" is
a claim about whether code reads a binding, and nothing checks it. The honest mitigation for now is that
`bindings:check` makes the _declared_ set impossible to misstate in either direction, which is the half
that caused a real problem.
