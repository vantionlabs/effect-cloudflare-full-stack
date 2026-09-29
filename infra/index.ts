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

// ─── Session cache ────────────────────────────────────────────────────────────────────────
// better-auth sessions. Eventually consistent is correct here: a session read that is 60s
// stale is fine, whereas the review queue is not (which is why the queue never touches KV).
const sessions = new cloudflare.WorkersKvNamespace("sessions", {
  accountId,
  title: name("sessions")
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

// ─── Outputs ──────────────────────────────────────────────────────────────────────────────
// Consumed by apps/worker/wrangler.jsonc. `pulumi stack output --json` feeds the deploy
// workflow, so binding ids are never hand-transcribed.
/*
 * ─── Vectorize is NOT declared here, and cannot be ────────────────────────────────────────
 *
 * `@pulumi/cloudflare` 6.21.0 ships 1216 resources and **none of them is Vectorize**. Checked, not
 * assumed. So the managed-store arm of the retrieval comparison cannot be provisioned as code with this
 * provider; it needs the CLI:
 *
 *   wrangler vectorize create effect-ai-policy-dev --dimensions=1024 --metric=cosine
 *
 * 1024 to match EMBEDDING_DIMENSIONS and `@cf/baai/bge-m3`, cosine to match the operator class the
 * pgvector index uses — otherwise the two arms would be compared on different distance metrics.
 *
 * That is a real gap in the IaC story and an argument against adopting Vectorize as production: a
 * resource created by hand is a resource nobody can reproduce or review. Worth weighing alongside its
 * two bigger problems (no lexical half, so `retrieval_mode` is never "hybrid" and rail 4 refuses to
 * auto-approve; and no row-level security, so tenancy rests on a metadata filter alone).
 *
 * Interestingly the provider DOES have `AiSearchInstance`, `AiSearchNamespace` and `AiSearchToken` —
 * AutoRAG under its current name. So the fully managed option is declarable as code while the
 * build-it-yourself-on-Vectorize option is not, which is the opposite of what one would guess.
 *
 * Workers AI needs no resource at all: the `ai` binding in wrangler.jsonc is the whole declaration.
 */

export const r2BucketName = documents.name
export const kvNamespaceId = sessions.id
export const queueName = events.queueName
export const queueDlqName = eventsDlq.queueName
export const hyperdriveId = hyperdrive.id
export const hyperdriveCachedId = hyperdriveCached.id
