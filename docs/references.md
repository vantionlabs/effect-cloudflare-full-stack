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

### Neuron economics: the retrieval gate is nearly free, the decision eval is not

Measured 2026-09-30 by summing `usage_metadata.neurons` across the AI Gateway's entire log history (178
entries) — so these are observed costs on this account, not catalogue arithmetic.

| Model                                      | Calls | Uncached | Neurons (total) | Per uncached call |
| ------------------------------------------ | ----- | -------- | --------------- | ----------------- |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 126   | 25       | **1,185.82**    | ≈ **47**          |
| `@cf/baai/bge-m3` (embeddings)             | 52    | 4        | **0.05**        | ≈ **0.02**        |

Overall cache hit rate: **83.7%**. A cached entry reports `cost: 0` and `latency: 0`.

**This corrects a claim that had been repeated in `AGENTS.md` and `docs/services.md`:** that the retrieval
gate could not pass because the Workers AI account had no neurons. `evals/RetrievalRecall.ts` **imports no
language model at all** — only `EmbedderWorkersAiRest` — so a full run costs a fraction of a neuron. It was
run on 2026-09-30 and passed:

```
heading (ours)  k=3   lexical 84.6%   hybrid 100.0%   MRR 0.722
langchain 150   k=3   lexical 84.6%   hybrid 100.0%   MRR 0.694
langchain 300   k=3   lexical 76.9%   hybrid  84.6%   MRR 0.708
langchain 600   k=3   lexical 38.5%   hybrid  38.5%   MRR 0.333
langchain 1200  k=3   lexical  7.7%   hybrid   7.7%   MRR 0.083
```

So **retrieval quality is now a known number** rather than an assumption, and ADR-0023's claim that the
LangChain splitter is kept "to lose an eval" is measured: it ties at 150 and degrades sharply above it,
because a 600- or 1200-character chunk stops aligning with an article boundary.

**What is actually expensive is `bun run evals`**, the decision eval, at several language-model calls per
case. At ~47 neurons an uncached call, a 99-case run does exceed a day's 10,000 allocation — which is the
claim that was true and that got generalised to the wrong command. The gateway's 1-hour cache makes a
_repeat_ of an identical run free, but not the first one.

A caveat on these figures: only calls that go **through the gateway** are logged, so anything that bypassed
it before 2026-09-30 is not counted. The per-call rates are what to reuse, not the totals.

### Mistral OCR: the stateless endpoint, and a data URI or a 422

Checked 2026-09-30 against `docs.mistral.ai` (capabilities/OCR and the `/v1/ocr` endpoint reference).
**Not verified by execution** — there is no Mistral key on this account — so this row is the contract the
adapter was written against, and the date is what makes a later disagreement legible.

| Fact           | Value                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Endpoint       | `POST https://api.mistral.ai/v1/ocr`, `Authorization: Bearer <key>`                                                 |
| Document       | `document: { type: "document_url", document_url }` for PDF/Office, `{ type: "image_url", image_url }` for images    |
| **Base64**     | must be a **data URI** — `data:application/pdf;base64,<b64>`. **Raw base64 returns 422**                            |
| Response       | `{ pages: [{ index, markdown, images, tables, dimensions, confidence_scores, blocks }], model, usage_info }`        |
| Bounding boxes | `include_blocks: true` (the default) returns paragraph-level boxes; images carry `top_left_x/y`, `bottom_right_x/y` |
| Confidence     | `confidence_scores_granularity: "page"                                                                              |
| Statefulness   | the endpoint is stateless: the document is supplied in the request                                                  |

Three consequences this repo depends on:

- **Stateless is a legal property here, not only an architectural one.** Mistral's Zero Data Retention is
  available on the Scale plan **for stateless calls only** and not for stateful products (files, batch,
  conversations, libraries) — plan risk R8. The file-upload form of this same API therefore may not be used,
  and the adapter sends a data URI instead. Our documents are private in R2, so a public URL is not an
  option either; the data URI is the only form that is both stateless and doesn't publish the document.
- **`mistral-ocr-latest` must never be configured.** A parser version defines the verbatim contract, so a
  floating tag would let a provider-side upgrade change what `containsVerbatim` accepts, silently, in the
  direction of a decision that used to be grounded no longer being so. `MISTRAL_OCR_MODEL` is required with
  no default when a key is present, and the model string is part of the parsed-text cache key.
- **`blocks` and `confidence_scores` are available and unused so far.** Block confidence is a natural rail-2
  input — a low-confidence block is a reason to force review — and bounding boxes would let the reviewer UI
  show _where on the page_ a `source_span` came from, which no text parser can offer. `ParsedDocument` has
  nowhere to put either yet, so both are left on the table deliberately rather than by oversight.

### `anydoc` runs in `workerd` — verified by execution, plus a package-name trap

Checked 2026-09-30 by building `apps/worker/test/fixtures/anydoc/` and running it under `createTestHarness`.
The plan asserted that anydoc "already ships a WebAssembly build, which is the only version worth having";
that is true, and it is not the package you get by guessing.

**The name matters.** `npm view anydoc` returns an unrelated package described as a _"node web server"_.
The real one is **`@firecrawl/anydoc`** — and that ships **native N-API binaries** (`darwin-arm64`,
`linux-x64-gnu`, …) with `engines: node >= 20`, which cannot run on `workerd`. The WASM build is a THIRD
package, **`@firecrawl/anydoc-wasm`**, which is not an optional dependency of the other one and does not
appear in its metadata. Two wrong choices are one keystroke away from the right one.

| Fact              | Value                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Package           | `@firecrawl/anydoc-wasm`, pinned **exactly** at `0.2.4` (MIT)                                |
| Dependencies      | **none**, and no Node builtins — a wasm-bindgen web target, so nothing needs shimming        |
| Size              | 6.38 MiB raw, 2.79 MiB gzipped; 6 files                                                      |
| Formats           | `doc docx odt pdf ppt pptx rtf epub xlsx ods odp csv` — **no `.md`/`.txt`**, so tier 1 stays |
| Init in `workerd` | **~1 ms** via `initSync({ module })`                                                         |
| Init in Node      | ~15 ms, because the compile happens at runtime there                                         |
| Parse `.docx`     | ~16 ms cold, <1 ms warm                                                                      |
| Worker bundle     | 16.4 MiB uncompressed with it, of a **64 MiB** limit                                         |

**`initSync` is the only usable entry point.** wasm-bindgen's default `init()` does
`fetch(new URL('anydoc_wasm_bg.wasm', import.meta.url))`, which has no meaning in a Worker. `initSync` takes
a `WebAssembly.Module`, which is exactly what wrangler hands you for a `.wasm` import — and because wrangler
compiles it at BUILD time, initialisation is ~1 ms rather than the hundreds a runtime compile would cost.

**`formatFromBytes` returns undefined for text formats.** A `.csv` has no magic bytes and is
indistinguishable from plain text, so the filename extension is a required fallback, not a convenience.
Sniffing is still tried first, because a container format like `.docx` is identifiable without trusting an
uploaded filename.

### Worker size limits: the compressed caps were removed on 2026-09-04

Checked 2026-09-30. The 3 MB (Free) / 10 MB (Paid) **compressed** limits are gone; Cloudflare now checks
only the **uncompressed** bundle, at **64 MiB across all plans**. This is what makes a 6.38 MiB wasm module
viable, and it is why the plan's "the 64 MiB bundle limit makes size a non-issue" is correct rather than
optimistic — verified rather than assumed, because it was written before the change.

What replaces it as the real constraint is **startup time: 1 second** for a Worker's global scope. So a
large module is initialised lazily inside a handler, even though the measured cost here (~1 ms) means the
budget is not actually at risk.

### The AI Gateway `effect-ai-ai-dev` exists and is carrying traffic — checked against the account

Checked 2026-09-30 via the `cf-ai-gateway` MCP server (`list_gateways`, `list_logs`). **This row exists
because its absence caused a wrong answer**: a code comment said "no gateway exists on the account yet", it
went stale silently, and it was then read and reported as a current finding. An inline claim has no date to
be judged against, which is what the rule at the bottom of this file is for.

| Fact                      | Value                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway ids               | `effect-ai-ai-dev`, `effect-ai-ai-staging`, `effect-ai-ai-production` — one per environment as of 2026-10-01; before that every environment shared the dev one |
| Created                   | **2026-09-29 16:18:23** — so Pulumi _was_ applied for this resource                                                                                            |
| Settings                  | `cache_ttl: 3600`, `cache_invalidate_on_update: true`, `collect_logs: true`, rate limit 600/60s sliding — exactly what `infra/index.ts` declares               |
| Log volume                | 178 entries on the dev gateway when last measured                                                                                                              |
| `workers_ai_billing_mode` | `postpaid` (not unified/prepaid credits)                                                                                                                       |
| `zdr`                     | `false` — as `infra/index.ts` intends, since Zero Data Retention is a per-client decision (plan risk R8)                                                       |

**The embedder's routing is verified by execution, with a before/after.** The logs contain only
`@cf/meta/llama-3.3-70b-instruct-fp8-fast` from 14:42 UTC, and `@cf/baai/bge-m3` appears first at 17:00 UTC —
after the embedder commit at 16:36 UTC. Before the fix the embedder was invisible to the gateway; after it,
it is not.

**Caching works, and the numbers are the reason it was wanted.** A cached entry reports `cached: true`,
`cost: 0` and `latency: 0`. An uncached `llama-3.3-70b` call at 888 in / 32 out cost **30.23 neurons**; one at
478 in / 361 out cost **86.68 neurons**; an uncached `bge-m3` call cost **0.02 neurons**. So a repeated eval
run over identical fixtures is free, which is what makes the 10,000-neuron daily allocation survivable.

One thing the logs do NOT show: `request` and `response` are empty strings and `prompts` is null, because
log storage of bodies is off. Worth knowing before planning to use gateway logs as an eval-run store — they
give cost, tokens, latency and cache status, not the prompt.

### Cron Triggers: in Cloudflare's dialect weekday `1` is SUNDAY — checked 2026-10-01

From the Cron Triggers docs: _"Days of the week go from 1 = Sunday to 7 = Saturday, which is different on some
other cron systems (where 0 = Sunday and 6 = Saturday)."_ Three-letter names are accepted, case-insensitively. So
the weekly report's trigger is written `0 6 * * MON`, never `0 6 * * 1`, which here would fire on Sunday. Verified
locally with `wrangler dev --test-scheduled` and `/cdn-cgi/handler/scheduled?cron=0+6+*+*+MON`: the handler
dispatches on `controller.cron`, which arrives exactly as written in `wrangler.jsonc`. `triggers` is not
inheritable, so the expression is repeated in every environment and `bindings:check` asserts each has crons.

### Workers AI through AI Gateway: a header on REST, a run option on the binding

Checked 2026-09-30 against `/ai-gateway/usage/providers/workersai/`, `/ai-gateway/usage/rest-api/` and the
changelogs of 2026-05-21 and 2026-08-07. Recorded because the two transports differ and the difference is
invisible when you get it wrong — the call succeeds either way, unmetered and uncached.

| Transport                   | How the gateway is named                                                | Source                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REST, `/ai/run/@cf/{model}` | the **`cf-aig-gateway-id` header**. The URL does not change             | _"that path (`/ai/run/@cf/{model}`) continues to work. To call Workers AI models through AI Gateway, use the `@cf/` model prefix … and include the `cf-aig-gateway-id` header to specify which gateway to route through"_ |
| REST, provider-specific     | `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/workers-ai/…` | the provider endpoint list                                                                                                                                                                                                |
| Binding, `env.AI.run`       | a third argument, `{ gateway: { id, skipCache, cacheTtl } }`            | the 2026-08-07 changelog and `/agents/runtime/operations/using-ai-models/`                                                                                                                                                |

Three consequences this repo depends on:

- **The embedder needed only a header**, not a URL rewrite — which is why `EmbedderWorkersAi` keeps
  `api.cloudflare.com` while `LanguageModelWorkersAi` switches host. That asymmetry looks like an
  inconsistency and is not; both files say so, and a test asserts each.
- **Authorisation is the Workers AI permission, not the AI Gateway one.** _"All `/accounts/{account_id}/ai/*`
  endpoints require the Workers AI permission… A token that holds only an `AI Gateway` permission returns
  `401` with error code `10000`."_ The `AI Gateway` permissions govern `/ai-gateway/*`, which is gateway
  configuration and logs. So a token minted for "the gateway" cannot call a model through it — worth knowing
  before debugging a 401 as a routing problem.
- **The gateway id `default` creates a gateway on the first authenticated request.** So a missing gateway
  never has to block a call. It is not what this repo uses, because an auto-created gateway does not carry
  the `cacheTtl: 3600` that `infra/index.ts` declares, and the cache is the reason the gateway is wanted.

### A Cloudflare Workflow retries STEPS, not the instance — verified by execution

Measured 2026-09-30 with `apps/worker/test/DecideWorkflow.test.ts`, because it contradicted what the
step-memo probe appeared to show and the difference decides where work may be placed.

**An error thrown outside a `step.do` fails the whole instance, with no retry.** The first version of
`DecideWorkflow` ran the rails and the write outside any step; the instance ended `errored` with every
counter at 1. Adding nothing but `step.do("Settle", …)` around the same function made it retry.

**A step retry resumes at the failed step. It does not re-enter `run()`.** Same test: the short circuit,
which sits outside any step, ran **once per instance** while the settle step ran twice. So the earlier
reading of the probe — "`run()` re-executes from the top and the cached steps are skipped" — was wrong
about the mechanism while right about the outcome. Step `one` was never re-run because nothing re-ran it,
not because a memo declined to.

Three consequences this repo depends on:

- **Anything that needs a retry must be inside a step.** For the decide pipeline that is the write, whose
  retry would otherwise be strictly worse than the Cloudflare Queue it replaces.
- **A retryable step must be idempotent**, because a retry can re-enter it after a partial success. The
  decision insert became `on conflict (organization_id, decide_key) do nothing returning id` for exactly
  this reason — a plain insert would have violated the constraint on every attempt after the first commit.
- **Code outside a step runs once per instance**, which makes it the right place for a read of current state
  (the short circuit) and the wrong place for anything that must be re-attempted.

### A `step.do` return must be PROVABLY serializable, and a recursive JSON type breaks the check

Found 2026-09-30 while typing `DecideWorkflow`'s step boundary. `step.do`'s return type is a **mapped type**
(`Serializable<T>` descends into every property), with two consequences:

- **`unknown` is rejected**, correctly — it admits `undefined`, a `Map`, a class instance with methods. The
  module's step schema carries `fields: unknown` (a decoded invoice: JSON in fact, opaque in the type
  system), so the boundary needs its own view.
- **A recursive `Json` union makes the mapped type diverge**: `TS2589: Type instantiation is excessively deep
  and possibly infinite`. The platform can only check a boundary it can finish traversing, so the boundary
  is typed as `object` — non-recursive, and true.

Related: **an exported anonymous class cannot inherit protected members.** `makeDecideWorkflow` returns a
class expression, and `WorkflowEntrypoint`'s `ctx`/`env` are protected, so declaration emit fails with
`TS4094`. Annotating the factory's return type with a constructor interface fixes it and keeps the anonymous
class an implementation detail.

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

## Email

### `resend@6.31.0` bundles for Workers, and swallows transport errors — verified 2026-10-01

**Checked by reading the published bundle and by building, not from the docs.** `dist/index.mjs` is `fetch`-based
and imports no node builtins. Its static imports are `postal-mime` and `standardwebhooks`; the latter's own deps
are `@stablelib/base64` and `fast-sha256` — pure JS, no `node:crypto`. `@react-email/render` is a **peer**,
reached only through `await import(...)` inside a try/catch on the React-element path.

Both bundlers tolerate that import, differently:

- `wrangler deploy --dry-run` (esbuild) leaves `await import("@react-email/render")` in place, unresolved.
- the console's vite build (rolldown) emits a 0.25 kB `render_resend-*.js` chunk marked
  `__vite-optional-peer-dep`, which throws if loaded.

Neither runs unless a message carries a React element, and nothing here sends one. No React enters the Worker,
and `bundle:check` confirmed the browser bundle has no Resend.

**The SDK catches transport failures itself.** A rejected `fetch` comes back as a resolved `{ error }` whose
message is _"Unable to fetch data. The request could not be resolved."_, so DNS, timeout and TLS failures are
indistinguishable in our logs. Found when a test asserting on the real cause failed; `EmailResend.test.ts` now
pins the measured behaviour.

### Inbound email: `postal-mime@4.0.2` and the local email endpoint — checked 2026-10-01

- **`postal-mime` 4.0.2 is MIT-0** (npm `license`), ESM with its own types, and parses a Worker's `message.raw`
  (`ReadableStream<Uint8Array>`) directly via `PostalMime.parse(raw)`. `Email.messageId`, `from: { name, address }`,
  `subject`, `text` and `html` are what we read. 2.7.6 is also in the tree, as a dependency of `agents` and `resend`.
- **Local testing posts to `/cdn-cgi/local/email?from=…&to=…`** with a raw RFC 5322 body (Cloudflare's Email
  Routing local-development docs; earlier changelog posts call it `/cdn-cgi/handler/email`). It needs a `Message-ID`.
  Measured: Miniflare 5.20260926.1 sends it to the ENTRY worker — under the console's Vite plugin that is the console,
  which has no `email()`, and an `MF-Route-Override` header did not get through the plugin. So the email e2e posts to
  the API Worker run on its own (`wrangler dev`, :8787), which shares the compose Postgres.
- **A refused message bounces.** `message.setReject(reason)` returns the reason to the sender (locally: a 400 with
  "Worker rejected email with the following reason: …"). We use it for unknown addresses and oversized messages only;
  auto-replies and over-limit mail are recorded as refused, not bounced, to avoid mail loops and backscatter.

### better-auth 1.7.6's email senders — read in `dist/`, 2026-10-01

- **No `sendResetPassword` → `400 RESET_PASSWORD_DISABLED`** (`api/routes/password.mjs`), not a silent 200. An
  earlier draft of the code comment claimed the latter.
- **Senders are awaited, not backgrounded**, unless `advanced.backgroundTasks.handler` is set
  (`context/create-context.mjs`, `runInBackgroundOrAwait`). So a slow provider adds request latency, and on
  Workers nothing is left dangling without `waitUntil`.
- **Rejection handling is inconsistent.** `runInBackgroundOrAwait` catches and logs through better-auth's
  logger, and it wraps reset, sign-up/sign-in verification and both invitation sends. The explicit
  `/send-verification-email` endpoint awaits the sender bare (`api/routes/email-verification.mjs:32`), so a
  throw there is a 500. `SessionHttp.ts` swallows in our own sender for that reason.
- **The organization plugin builds no invitation URL.** `sendInvitationEmail` gets the invitation id, and the
  application chooses the accept page. Reset and verification URLs are better-auth's own endpoints, which
  redirect to `callbackURL`.

---

## How to keep this file honest

Every row says how it was checked and on what date. When a claim here is used to justify something, the
justification should cite the row rather than restate the fact — so that updating one row updates
everything that depends on it.

**The rows most likely to go stale first**, and what changes when they do:

| Row                           | Watch for                                   | Then                                                                                                          |
| ----------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@effect/platform-cloudflare` | first npm publish                           | re-open ADR-0003; our `WorkflowEnginePg` gains an official alternative                                        |
| Workers AI free tier          | a paid plan, or a gateway cache             | `bun run evals` can complete a 99-case scored run                                                             |
| Workflow retry semantics      | a Cloudflare change to instance-level retry | the placement rule ("anything needing a retry is inside a step") would relax                                  |
| AI Gateway routing            | a gateway existing on the account           | the adapters stop being unmetered; `cf-aig-gateway-id` becomes verified by execution rather than by assertion |
| Effect RC churn in Alchemy    | a clean dependency audit                    | ADR-0007's reason for Pulumi expires                                                                          |
| PlanetScale region            | a region near the user                      | ADR-0015's arithmetic changes                                                                                 |

### `@cloudflare/vite-plugin` flattens the wrangler environment at BUILD time, not deploy time

Found 2026-10-01 by the first real staging deploy, which shipped the console under the **production** name
bound to the **production** API.

The plugin emits its own wrangler config plus a `.wrangler/deploy/config.json` redirect, so
`wrangler deploy` follows the redirect — it says so, `Using redirected Wrangler configuration` — and the
generated config is **already flattened** for whichever environment the BUILD selected. It contains no `env`
blocks at all, so a `--env staging` flag at deploy time has nothing to resolve and is **silently a no-op**.

| build                               | generated `name`            | generated `services`       |
| ----------------------------------- | --------------------------- | -------------------------- |
| `vite build`                        | `effect-ai-console`         | `API -> effect-ai`         |
| `CLOUDFLARE_ENV=staging vite build` | `effect-ai-console-staging` | `API -> effect-ai-staging` |

So the environment is chosen with `CLOUDFLARE_ENV` on the build, and the deploy takes no `--env`.

**Why this is worth a row rather than a comment.** `apps/console/wrangler.jsonc` already warns, on the
binding itself, that "staging's console must reach STAGING's API, and inheriting would silently point it at
production". The warning was right and the mechanism defeated it: the flattening happens before wrangler sees
the flag, so the config that was reviewed is not the config that deployed. A no-op flag that looks like it
worked is the worst shape this class of bug has — `wrangler deploy --env staging` exits 0 and prints a
success.
