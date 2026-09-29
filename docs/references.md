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
