/**
 * Integration test: the real Worker, in real `workerd`, against the real Postgres.
 *
 * Boots via wrangler's `createTestHarness`, so this exercises the whole stack the manual
 * probe did — the `cloudflare:sockets` Duplex adapter, the Hyperdrive binding, the memoised
 * layer graph, `HttpApiBuilder` routing and schema encoding — but repeatably, in CI.
 *
 * Requires `docker compose up -d` (see compose.yaml) and apps/worker/.env.
 */
import { HealthV1 } from "@ea/modules/shared/api/V1"
import { Schema } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestHarness } from "wrangler"

let server: ReturnType<typeof createTestHarness>

beforeAll(async () => {
  server = createTestHarness({
    workers: [{ configPath: new URL("../wrangler.jsonc", import.meta.url).pathname }]
  })
  await server.listen()
})

afterAll(async () => {
  await server?.dispose?.()
})

describe("GET /api/v1/health", () => {
  it("reports ok, and decodes against the published wire schema", async () => {
    const response = await server.fetch("/api/v1/health")
    expect(response.status).toBe(200)

    // Decoding with the same schema a client would use is the point: a response that the
    // contract cannot parse is a broken API even when the status code is 200.
    const health = Schema.decodeUnknownSync(HealthV1)(await response.json())

    expect(health.status).toBe("ok")
    expect(health.database).not.toBeNull()
  })

  it("confirms the two capabilities the data layer depends on", async () => {
    const response = await server.fetch("/api/v1/health")
    const health = Schema.decodeUnknownSync(HealthV1)(await response.json())

    // pgvector present: without it there is no semantic half of hybrid retrieval.
    expect(health.database?.pgvector_version).not.toBeNull()

    // Dutch stemming working: this is risk R4a. If it regresses, retrieval misses clauses,
    // rail 1 escalates everything, and the queue silently fills with work a human must do.
    expect(health.database?.dutch_stemming).toBe(true)
  })
})

describe("routing", () => {
  it("serves the OpenAPI document derived from the same declaration", async () => {
    const response = await server.fetch("/api/v1/openapi.json")
    expect(response.status).toBe(200)

    const document = await response.json() as { openapi: string; paths: Record<string, unknown> }
    expect(document.openapi).toMatch(/^3\./)
    expect(Object.keys(document.paths)).toContain("/api/v1/health")
  })

  it("404s an unknown path rather than falling through", async () => {
    const response = await server.fetch("/not-a-route")
    expect(response.status).toBe(404)
  })
})

describe("connection lifetime", () => {
  it("survives repeated requests to the same isolate", async () => {
    // Regression guard. A TCP socket cannot outlive the request that opened it on Workers,
    // so memoising the PgClient per isolate produced: request 1 ok, request 2 degraded,
    // request 3 hangs the Worker entirely. One manual curl cannot catch that; three
    // sequential requests can. See platform/Database.ts.
    for (let i = 0; i < 3; i++) {
      const response = await server.fetch("/api/v1/health")
      expect(response.status, `request ${i + 1} of 3`).toBe(200)

      const health = Schema.decodeUnknownSync(HealthV1)(await response.json())
      expect(health.status, `request ${i + 1} of 3`).toBe("ok")
      expect(health.database, `request ${i + 1} of 3`).not.toBeNull()
    }
  })
})
