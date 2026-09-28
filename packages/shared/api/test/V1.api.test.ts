/**
 * Contract tests for the versioned public API.
 *
 * These are cheap and they guard a property that is easy to break silently: the wire schema
 * is what a client we do not control (the Laravel consumer) compiles against, so a field
 * rename here is a breaking change even though nothing in our own code fails.
 */
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { ApiV1, DatabaseHealthV1, HealthV1 } from "../src/V1/index.ts"

describe("ApiV1 contract", () => {
  it("declares the health group under the /api/v1 prefix", () => {
    // The prefix is load-bearing: v1 paths are frozen, and a future v2 must not shadow them.
    expect(ApiV1.identifier).toBe("effect-ai-v1")
    expect(Object.keys(ApiV1.groups)).toContain("health")
  })
})

describe("HealthV1 wire schema", () => {
  const decode = Schema.decodeUnknownSync(HealthV1)

  it("round-trips a healthy response", () => {
    const decoded = decode({
      status: "ok",
      version: "abc123",
      database: {
        postgres_version: "17.11",
        pgvector_version: "0.8.6",
        dutch_stemming: true
      }
    })

    expect(decoded.status).toBe("ok")
    expect(decoded.database?.dutch_stemming).toBe(true)
  })

  it("accepts a null database, because unreachable is a reportable state not a crash", () => {
    const decoded = decode({ status: "degraded", version: "dev", database: null })
    expect(decoded.database).toBeNull()
  })

  it("rejects a status outside the closed set", () => {
    // `status` is a closed literal union on purpose: a monitor that sees an unexpected value
    // cannot act on it, so an invalid one must fail at the boundary rather than propagate.
    expect(() => decode({ status: "probably-fine", version: "dev", database: null })).toThrow()
  })

  it("requires pgvector_version to be present as a key, even when null", () => {
    // Distinguishing "extension absent" (null) from "we forgot to look" (missing) matters:
    // the first is a degraded database, the second is a broken health check.
    expect(() =>
      Schema.decodeUnknownSync(DatabaseHealthV1)({
        postgres_version: "17.11",
        dutch_stemming: true
      })
    ).toThrow()
  })
})
