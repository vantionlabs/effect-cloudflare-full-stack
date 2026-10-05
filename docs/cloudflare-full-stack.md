# The Cloudflare full stack, for somebody new to it

What runs where, where configuration lives, how local development works, and why the environments do not
share a database. Written because the platform's vocabulary (`vars` vs secrets vs bindings, Pages vs
Workers, Hyperdrive vs Postgres) is the part that is genuinely confusing, and none of it is guessable.

Companion reading: [`services.md`](services.md) for _why_ each service was chosen, and
[`adr/0001-console-on-pages-api-on-a-subdomain.md`](adr/0001-console-on-pages-api-on-a-subdomain.md) for the
split between the console and the API.

## 1. The shape of it

```
                       browser
                          │
           ┌──────────────┴───────────────┐
           ▼                              ▼
static files (no Worker runs)      /api/*  and  /auth/*
Pages: effect-ai-console-*                 │
                                           ▼
                                Pages Function  functions/api/[[path]].ts
                                a three-line proxy, no rewriting
                                           │
                                  service binding — Worker to Worker
                                  inside Cloudflare, no public request
                                           ▼
                                   Worker: effect-ai
                                fetch() · queue() · scheduled()
                                           │
     ┌───────────────┬──────────────┬──────┴───────┬──────────────┐
     ▼               ▼              ▼              ▼              ▼
Hyperdrive        R2            KV            Queue        Workers AI
(pooling)      documents       cache      effect-ai-events   via AI Gateway
     │                                          │
     ▼                                          ▼
Neon Postgres 18.6 (Frankfurt)       the SAME Worker's queue() handler
+ pgvector + Dutch FTS               (one deploy, two entrypoints)
```

Four things a newcomer should take from that diagram:

**One Worker, three entrypoints.** `export default { fetch, queue, scheduled }`. The HTTP API, the
asynchronous document pipeline and (eventually) the cron are the same deployed script sharing one layer
graph — not three services. `apps/worker/src/Main.ts` is the composition root for `fetch`;
`apps/worker/src/platform/DispatchEvent.ts` is the queue's half.

**Hyperdrive is a connection pooler, not a database.** This is the single most common confusion. A Worker
is created and destroyed around each request, so it cannot hold a warm TCP connection pool the way a
long-lived Node server does — and Postgres connections are expensive to open. Hyperdrive keeps the pool
_outside_ the Worker and hands it a connection in single-digit milliseconds. The database is Neon;
Hyperdrive is the thing in front of it.

**Pages and the Worker are two different deploys.** Pages serves the console's static files without
invoking any Worker at all, which is why static requests cost nothing. The Worker is the API. Because they
deploy separately they can disagree, which is why the pipeline deploys the Worker **first** — the console
calls the API, so an old API under a new console breaks, while an old console against a new API does not.

**The proxy exists only because there is no custom domain yet.** `*.pages.dev` and `*.workers.dev` are
different registrable domains, so no cookie can be shared between them. The Pages Function forwards
`/api/*` to the Worker over a service binding so the browser sees **one origin** and the session cookie
works. When a real domain lands, the API moves to `api.example.com`, three cross-origin settings turn on
together, and the Function is deleted. ADR-0001 has the detail, including two bugs this shape caused.

## 2. Where configuration lives in the cloud

There are **four** separate places, and conflating them is the usual source of a confusing outage.

|                | lives where                                                                                       | in git?                           | how it is set                            | read in code as                                         |
| -------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| **`vars`**     | `wrangler.jsonc`, uploaded with the script; plaintext in the dashboard                            | **yes**                           | edit the file, redeploy                  | `Config.String("BASE_URL")`                             |
| **Secrets**    | encrypted on Cloudflare, per Worker **per environment**; write-only — you can never read one back | no                                | `wrangler secret put NAME --env staging` | `Config.Redacted("BETTER_AUTH_SECRET")`                 |
| **Bindings**   | `wrangler.jsonc`, by resource id or name. Not values — capability handles                         | **yes** (ids are not credentials) | the resource must already exist          | `env.HYPERDRIVE`, `env.DOCUMENTS`                       |
| **CI secrets** | GitHub → Settings → Secrets → Actions                                                             | no                                | `gh secret set CLOUDFLARE_API_TOKEN`     | never — these are for the _deploy tooling_, not the app |

That last row is worth dwelling on. `CLOUDFLARE_API_TOKEN` is not an application setting; it is the
credential `wrangler` uses to _perform_ a deploy. It never reaches the running Worker. Conversely
`BETTER_AUTH_SECRET` is never needed by CI — it is needed by the Worker at runtime and lives on Cloudflare.
People put each in the other's place and get a confusing failure.

In this repo, as of writing:

```
vars      ENVIRONMENT  BASE_URL  ALLOWED_HOSTS
          CLOUDFLARE_ACCOUNT_ID  CLOUDFLARE_AI_GATEWAY  AI_GATEWAY
secrets   BETTER_AUTH_SECRET  CLOUDFLARE_AI_TOKEN  EMBEDDING_API_KEY
bindings  HYPERDRIVE  DOCUMENTS (R2)  CACHE (KV)  EVENTS (queue)  AI
```

**In the Worker's code all of them arrive identically**, on the `env` object, and Effect's `Config` reads
them the same way. The code cannot tell a var from a secret, which is the point: moving a value from one to
the other is a deployment decision, not a code change.

Two rules that are easy to get wrong:

- **Something that grants access is a secret, even if it looks boring.** `OTLP_HEADERS` is declared optional
  on `Env` and is not set anywhere yet — when it is, it carries an authorization header for the telemetry
  backend, so it is a secret, not a var. `CLOUDFLARE_ACCOUNT_ID` genuinely is a var: it is an identifier,
  not a credential, and it is already written in this repo's comments.
- **`vars` and bindings are NOT inherited into named environments.** Cloudflare: _"Non-inheritable keys are
  configurable at the top-level, but cannot be inherited by environments and must be specified for each
  environment."_ So every `env.staging` / `env.production` block must repeat all of them. Forgetting a
  binding deploys fine and throws at runtime; `scripts/bindings-check.ts` exists for exactly that, and
  `bun run bindings:check` is in `preflight`.

## 3. The local development flow

Nothing in the cloud is required to develop, with one exception noted below.

```sh
bun run db:up               # Postgres 18 + pgvector 0.8.5 on :55433, waits until healthy
bun run db:migrate:local    # apply migrations to THAT container (plain db:migrate targets DATABASE_URL)
bun run db:verify:local     # confirm pgvector and the Dutch stemmer are present

# ONE command for both Workers. The console's vite dev server boots the API as an AUXILIARY Worker,
# so the `API` service binding resolves and the browser has one origin, as it does deployed.
bun run dev                 # db:up, then console on :5173 with the API behind it

# The API alone, on its own port, when you are working on it rather than on the console.
bun run dev:worker          # wrangler dev — REAL workerd on :8787

# Both at once, one prefixed log — e.g. to send local email to the API's email() handler while using the console.
bun run dev:all
```

What each binding resolves to locally:

| binding                        | locally                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `HYPERDRIVE`                   | the compose container, via `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` |
| `DOCUMENTS`, `CACHE`, `EVENTS` | simulated by miniflare, persisted under `.wrangler/`                                  |
| `AI`                           | **remote.** Workers AI has no local emulation, so this one needs real credentials     |

Local `vars` and secrets come from `apps/worker/.env`, which is gitignored and documented by
`apps/worker/.env.example`. Copy and fill it.

The console forwards `/api/*` to the API over a **service binding** (`apps/console/src/server.ts`), so the
console is developed against the real Worker on one origin — not a mock. That is deliberate twice over: a
mock would drift from the API, and the same-origin property is what the deployment reproduces. Local
development therefore needs no CORS, and neither does production.

This used to be a `vite` proxy to `:8799`, and that is worth naming rather than quietly correcting: a proxy
was the only option while the console was a Pages project, and it stopped existing when the console became a
Worker with a service binding. For a while afterwards nothing bound `API` locally at all — the dev server
started fine and the first sign-in failed inside the fetch. `auxiliaryWorkers` in
`apps/console/vite.config.ts` is what makes the binding real locally, and it is the same topology as the
deploy rather than an imitation of it.

**`BASE_URL` in `apps/worker/.env` is load-bearing for local sign-in.** Without it wrangler falls back to
the `vars` in `wrangler.jsonc`, whose `BASE_URL` is the deployed **https** console — and `useSecureCookies`
is derived from that scheme, so the session cookie comes back marked `Secure`, the browser discards it over
plain http, and sign-in returns 200 having signed nobody in. It must name the console's origin
(`http://localhost:5173`), not the API's. This is the mirror of a bug already shipped once in the other
direction, where the cookie was NOT marked `Secure` deployed; neither version appears in a log.

The one thing that leaks: because the `AI` binding forces a remote runtime, `wrangler dev`, the
real-Worker test suite and the browser suite all need `CLOUDFLARE_API_TOKEN` in a non-interactive
environment. On a laptop
`wrangler login` has cached credentials so it is invisible; in CI it is not, which is why that suite is
gated and says so. See the traps section of `AGENTS.md`.

## 4. Do staging and production share a database? No.

They must not, and they do not: **each environment gets its own Neon project**, its own PAIR of Hyperdrive
configs, and its own R2 bucket, queue, dead-letter queue and KV namespace. Nothing is shared.

Three reasons specific to this product, beyond the general one:

1. **Migrations run forward on deploy.** A shared database means staging's migration alters production's
   tables before production's code ships. That is not a risk, it is a certainty the first time a column is
   renamed.
2. **The product's entire claim is an auditable decision trail.** Test decisions interleaved with real ones
   in the same `decisions` and `decision_citations` tables destroy the thing being sold.
3. **Two UNIQUE constraints would collide across environments.** `decisions.decide_key` and
   `document_fingerprints` exist so a redelivered message cannot produce a second decision. Staging
   replaying a fixture invoice would either collide with, or silently suppress, a production decision.

What they _do_ share: one migration set, so the schema is identical by construction. Nothing else.

The cost is why the provider changed. Neon's free allowances are **per project** — 100 CU-hours and 0.5 GB
each — so three projects is three independent budgets rather than three tenants of one, and a suspended
compute accrues nothing. PlanetScale billed per branch, daily, always on, at roughly $15/mo each. The
Cloudflare resources — R2, queues, KV — are free by comparison either way. See
[ADR-0002](adr/0002-neon-postgres-via-hyperdrive.md).

One number worth carrying around: Neon suspends after **5 minutes** idle, but Hyperdrive holds idle origin
connections for **10**, so a compute really suspends about **15 minutes** after the last query. Anything
polling the health endpoint more often than that keeps it awake permanently and exhausts the free compute
allowance in under three weeks.

### Two Hyperdrive configs per environment, not one

Hyperdrive caches read queries for 60s by default with **no write-through invalidation** — writing to the
database does not invalidate what Hyperdrive has cached. A reviewer who approves a decision and then sees a
60-second-stale queue is a bug, so each environment gets two configs against the same branch:

| binding             | caching           | used for                                                    |
| ------------------- | ----------------- | ----------------------------------------------------------- |
| `HYPERDRIVE`        | **disabled**      | the review queue, decision detail, every transactional read |
| `HYPERDRIVE_CACHED` | default 60s / 15s | the policy corpus, which is effectively static              |

Three environments × two configs = six. Watch the ~100-connection cap across configs. This is plan risk R3.

## 5. Branch → environment

| branch           | goes to                                    | how                                                  |
| ---------------- | ------------------------------------------ | ---------------------------------------------------- |
| `feature/*`, PRs | Pages preview only, no Worker deploy       | preview URL per deployment                           |
| `main`           | **staging**, automatically on green CI     | `effect-ai-staging` + `staging.<project>.pages.dev`  |
| —                | **production**, when a human dispatches it | `effect-ai-production` + the Pages production branch |

Production is never automatic. Merging and releasing stay separate decisions.

Note that Pages has no "staging" environment — it accepts only `production` and `preview` as environment
names. A branch deploy gets a stable alias for free (`wrangler pages deploy --branch staging` →
`staging.<project>.pages.dev`), so staging's console needs **no second Pages project**. One consequence: each
environment's `ALLOWED_HOSTS` must name its own console host rather than a shared `*.pages.dev` wildcard, or
staging's origin would be trusted by production's Worker.
