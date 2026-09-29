/**
 * Cloudflare infrastructure for effect-ai, as a Pulumi program.
 *
 * **Deliberately plain TypeScript with no Effect dependency.** This program shares nothing
 * with the Worker, so coupling it to Effect would buy no composition while exposing it to
 * every RC churn — which is exactly what blocked Alchemy (see
 * docs/runbooks/PatchingEffectDeps.md). `effect-pulumi` exists but declares `effect: ^3.0.0`,
 * so adopting it would recreate that problem on purpose.
 *
 * Replaces the earlier scripts/infra.sh: Pulumi brings real state, real diffing, and a
 * `preview` that reports what would change rather than a script that greps `wrangler list`.
 *
 *   pulumi preview   # read-only: what would change
 *   pulumi up        # apply. COSTS MONEY (see the Hyperdrive note below)
 *
 * Not managed here: the **PlanetScale Postgres cluster itself**. There is no Pulumi provider
 * for PlanetScale, and the Cloudflare partnership flow (which is what puts the cluster on
 * *your Cloudflare invoice*) is a dashboard/API action. So the cluster is created there once,
 * and its direct connection string is handed to this program as a secret config value. That
 * seam is recorded rather than hidden, because it is the one manual step.
 */
import * as cloudflare from "@pulumi/cloudflare"
import * as pulumi from "@pulumi/pulumi"

const config = new pulumi.Config()
const accountId = config.require("accountId")
const stack = pulumi.getStack()

/** Suffix every resource so `dev` and `production` stacks cannot collide in one account. */
const name = (base: string) => `effect-ai-${base}-${stack}`

// ─── Object storage ───────────────────────────────────────────────────────────────────────
// Source documents. Also where extractions' parsed text will live once it outgrows a column:
// it is blob-shaped, write-once, read-rarely, and only needed to re-run a verbatim check.
const documents = new cloudflare.R2Bucket("documents", {
  accountId,
  name: name("documents"),
  location: "WEUR" // EU data residency for Dutch clients; see the client-work section of PLAN.md
})

// ─── Read-through cache ───────────────────────────────────────────────────────────────────
/*
 * NOT a session cache, and the distinction is why this resource was deleted once and is now back.
 *
 * It was originally declared here for better-auth sessions, bound nowhere, and read by nothing — so the
 * plan described a cache that did not exist while every session lookup went to Postgres. It was removed
 * rather than left declared, because an unbound resource is a claim the code does not honour, and
 * `bun run bindings:check` now fails in BOTH directions so it cannot come back half-wired.
 *
 * It is back for a different job. Sessions are still the wrong thing to put here, for a reason that is
 * specific rather than cautious: better-auth's `secondaryStorage` interface requires atomic `getAndDelete`
 * and `increment`, KV has neither, and backing it with KV would **silently break rate limiting** — a
 * 6-digit OTP is only as strong as its attempt counter (see BetterAuth.ts).
 *
 * What it holds instead is parsed document text, keyed by document id AND parser version. That key is what
 * makes it safe: a parser version defines the verbatim contract, so a bump is a different key and cannot
 * serve text the current parser would not produce (plan risk R6). Every workflow redelivery otherwise
 * re-does an R2 GET plus a parse, on the hottest path in the product.
 *
 * The rule for anything added later is in `shared/domain/Cache/Cache.ts`: **the key must make staleness
 * impossible.** Not unlikely — impossible, because there is no invalidation.
 */
const cache = new cloudflare.WorkersKvNamespace("cache", {
  accountId,
  title: name("cache")
})

// ─── Event queue ──────────────────────────────────────────────────────────────────────────
// The DLQ is declared first so the main queue can reference it. A dead letter must land
// somewhere queryable: the consumer writes events.status = 'dead' so a failure is visible in
// the product rather than only in a dashboard.
const eventsDlq = new cloudflare.Queue("events-dlq", {
  accountId,
  queueName: name("events-dlq")
})

const events = new cloudflare.Queue("events", {
  accountId,
  queueName: name("events")
})

// ─── Postgres, via Hyperdrive ─────────────────────────────────────────────────────────────
// Hyperdrive terminates TLS to the origin and keeps the connection pool warm OUTSIDE the
// Worker. That is what makes the per-request connection in apps/worker/src/platform/Database.ts
// affordable — a p90 4ms handshake instead of a round trip to the origin region.
//
// TWO configs against the same database, on purpose. Hyperdrive caches reads for 60s by
// default and does NOT invalidate on write, so a reviewer who approves a decision and then
// sees a stale queue would be a bug. Transactional reads go through the uncached config.
const postgresUrl = config.requireSecret("postgresUrl")

const parsed = postgresUrl.apply((url) => {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: Number(u.port || "5432"),
    database: u.pathname.replace(/^\//, ""),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password)
  }
})

const hyperdriveOrigin = {
  host: parsed.host,
  port: parsed.port,
  database: parsed.database,
  user: parsed.user,
  password: parsed.password,
  scheme: "postgres"
}

/** Transactional: the review queue, decision detail, every write. Never serves stale rows. */
const hyperdrive = new cloudflare.HyperdriveConfig("pg", {
  accountId,
  name: name("pg"),
  origin: hyperdriveOrigin,
  caching: { disabled: true }
})

/** Cached: the policy corpus, which is effectively static between ingests. */
const hyperdriveCached = new cloudflare.HyperdriveConfig("pg-cached", {
  accountId,
  name: name("pg-cached"),
  origin: hyperdriveOrigin,
  caching: { disabled: false, maxAge: 60, staleWhileRevalidate: 15 }
})

// ─── AI Gateway ───────────────────────────────────────────────────────────────────────────
/*
 * One place in front of every model call, whoever serves the tokens.
 *
 * Declared here rather than made by hand because the provider HAS it — unlike Vectorize, which is the
 * gap documented below. `AiGateway` is a first-class resource, so this is reproducible and reviewable.
 *
 * **Why it is worth the resource.** It would already have paid for itself: a 99-case eval run failed on
 * all 99 with Workers AI code 4006, the free tier's 10,000 daily neurons — spent by REPEATED runs of the
 * same fixtures at temperature 0. Identical prompts. `cacheTtl` serves those repeats for nothing.
 *
 * Four settings below are product decisions rather than tuning:
 *
 *   `cacheTtl`                   1 h. Safe ONLY because a prompt fully determines its answer here: it
 *                                carries the extracted fields and the retrieved clauses. The corpus
 *                                version must therefore be part of the cache key — a cached decision
 *                                must never outlive a change to the policy it cites.
 *   `cacheInvalidateOnUpdate`    true, so a settings change cannot serve answers from the old config.
 *   `collectLogs`                true. This is where cost-per-decision becomes an observed number
 *                                instead of something only the eval harness knows (services.md §6).
 *   `rateLimiting*`              a sliding window, as a backstop against exactly the runaway loop that
 *                                exhausted the daily allocation. It protects the budget, not the users;
 *                                per-customer quota is a Durable Object (services.md §5).
 *
 * `zdr` is deliberately NOT set here. Zero Data Retention is a per-client contractual decision, not a
 * default — plan risk R8 — and turning it on globally would silently change what we can promise. It
 * belongs in a per-client stack config together with the provider profile.
 */
const aiGateway = new cloudflare.AiGateway("ai", {
  accountId,
  aiGatewayId: name("ai"),
  // One hour. The eval harness re-runs identical fixtures; production re-decides only on redelivery,
  // where the decide_key short circuit fires first and never reaches the model at all.
  cacheTtl: 3600,
  cacheInvalidateOnUpdate: true,
  collectLogs: true,
  // 600 requests per minute, sliding. A 99-case eval at concurrency 4 is nowhere near this; a runaway
  // retry loop is.
  rateLimitingInterval: 60,
  rateLimitingLimit: 600,
  rateLimitingTechnique: "sliding"
})

// ─── Outputs ──────────────────────────────────────────────────────────────────────────────
// Consumed by apps/worker/wrangler.jsonc. `pulumi stack output --json` feeds the deploy
// workflow, so binding ids are never hand-transcribed.
/*
 * ─── On provider gaps, and the technique for them ─────────────────────────────────────────
 *
 * Vectorize was evaluated and dropped (see docs/adr/0004 and the retrieval comparison), so nothing is
 * declared for it here. The finding is worth keeping, because it will recur:
 *
 * `@pulumi/cloudflare` 6.21.0 ships 1216 resources and **none is Vectorize**. Nor is there a
 * `cloudflare_vectorize` in the Cloudflare Terraform provider — which is the same gap from the other
 * side, since Pulumi's provider is bridged from Terraform's. Switching to Terraform would inherit it
 * exactly. Only `wrangler` and the REST API can create one.
 *
 * The escape hatch, when a gap has to be crossed: a `command.local.Command` from `@pulumi/command`
 * shelling out to wrangler, with `create` and `delete` and `|| true` on both for idempotency. It keeps
 * the property that matters — one graph, one `up`, one `preview`, and a `destroy` that really removes
 * the resource — where a resource created by hand is one nobody can reproduce or review.
 *
 * Note also what needs no resource at all: **Workers AI**. The `ai` binding in wrangler.jsonc is its
 * entire declaration, which is why adopting `@cf/baai/bge-m3` for embeddings required no infrastructure
 * change whatsoever. And the provider DOES have `AiSearchInstance`/`AiSearchNamespace` — AutoRAG under
 * its current name — so the fully managed option is declarable as code while build-it-yourself-on-
 * Vectorize was not.
 */

export const r2BucketName = documents.name
export const queueName = events.queueName
export const queueDlqName = eventsDlq.queueName
export const hyperdriveId = hyperdrive.id
export const hyperdriveCachedId = hyperdriveCached.id
export const aiGatewayId = aiGateway.aiGatewayId
export const cacheNamespaceId = cache.id
