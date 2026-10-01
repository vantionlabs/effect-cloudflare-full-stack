/**
 * A corpus document uploaded through the API is chunked and EMBEDDED by the queue consumer.
 *
 * Before `document.index`, a policy upload was stored and never indexed: only the eval harness and tests
 * populated `document_chunks`, so a customer had no way to add to the corpus. This drives the real path —
 * `POST /api/v1/intakes` -> `events` -> the local queue -> `IndexPolicyDocument` -> Workers AI — and polls the
 * database for the outcome, because the work happens after the 202.
 *
 * Embedded, not merely chunked: a chunk with no vector is lexical-only, and a test that counted rows would pass
 * on an indexer whose embedder was silently down.
 */
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Harness, startHarness } from "./Harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
})

afterAll(async () => {
  await harness?.dispose()
})

const MANUAL = [
  "# Kraan PK 23.500 — onderhoudshandboek",
  "",
  "## 1. Dagelijkse controle",
  "Controleer voor gebruik het hydrauliekoliepeil en de slangen op lekkage.",
  "",
  "## 2. Hydraulische druk",
  "De maximale werkdruk van het hoofdsysteem is 350 bar. Stel het overdrukventiel nooit hoger af.",
  "",
  "## 3. Smeerschema",
  "Smeer de draaikrans elke 50 bedrijfsuren met lithiumvet."
].join("\n")

const db = async <A>(f: (client: Client) => Promise<A>): Promise<A> => {
  const client = new Client({
    host: process.env["PGHOST"] ?? "localhost",
    port: Number(process.env["PGPORT"] ?? 55433),
    user: process.env["PGUSER"] ?? "effect_ai",
    password: process.env["PGPASSWORD"] ?? "local_dev_only",
    database: process.env["PGDATABASE"] ?? "effect_ai"
  })
  await client.connect()
  try {
    return await f(client)
  } finally {
    await client.end()
  }
}

const chunksOf = (documentId: string) =>
  db((client) =>
    client.query<{ total: number; embedded: number; collection: string }>(
      `select count(*)::int as total, count(embedded_at)::int as embedded, min(collection) as collection
         from document_chunks where document_id = $1`,
      [documentId]
    ).then((result) => result.rows[0]!)
  )

describe("document.index", () => {
  it("chunks and embeds a policy document uploaded through the API", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await harness.fetch(
      "/api/v1/intakes?collection=policy&filename=pk23500.md&content_type=text%2Fmarkdown",
      { method: "POST", headers: { "content-type": "application/octet-stream", cookie }, body: MANUAL }
    )
    expect(response.status).toBe(202)
    const { document_id } = (await response.json()) as { readonly document_id: string }

    // The consumer runs after the 202. Poll, with a deadline that a real embedding call fits inside.
    let chunks = await chunksOf(document_id)
    for (let attempt = 0; attempt < 60 && (chunks.total === 0 || chunks.embedded < chunks.total); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      chunks = await chunksOf(document_id)
    }

    // Three headed sections, each its own chunk; every one has a vector, and they stay in their collection.
    expect(chunks.total).toBeGreaterThanOrEqual(3)
    expect(chunks.embedded).toBe(chunks.total)
    expect(chunks.collection).toBe("policy")

    const event = await db((client) =>
      client.query<{ status: string }>(
        `select status from events where type = 'document.index' and idempotency_key = $1`,
        [`index:${document_id}`]
      ).then((result) => result.rows[0])
    )
    expect(event?.status).toBe("done")
  }, 120_000)

  it("does not index a transactional document — those are decided, not cited", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const response = await harness.fetch(
      "/api/v1/intakes?collection=transactional&filename=invoice.md&content_type=text%2Fmarkdown",
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream", cookie },
        body: "# Factuur\n\nTotaal EUR 10,00\n"
      }
    )
    const { document_id } = (await response.json()) as { readonly document_id: string }
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect((await chunksOf(document_id)).total).toBe(0)
  }, 30_000)
})
