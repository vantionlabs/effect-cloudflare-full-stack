/**
 * Contract tests for the versioned public API.
 *
 * These are cheap and they guard a property that is easy to break silently: the wire schema
 * is what a client we do not control (the Laravel consumer) compiles against, so a field
 * rename here is a breaking change even though nothing in our own code fails.
 */
import { Schema } from "effect"
import { OpenApi } from "effect/http-api"
import { describe, expect, it } from "vitest"
import { ApiV1, DatabaseHealthV1, HealthV1 } from "../src/v1/index.ts"

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
        postgres_version: "18.6",
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
        postgres_version: "18.6",
        dutch_stemming: true
      })
    ).toThrow()
  })
})

/**
 * The generated OpenAPI document, asserted directly.
 *
 * This is the artefact an integrating client reads, and every property below is one that nothing else
 * in the repo would notice was wrong: a handler compiles whatever status it answers with, and a missing
 * title is only visible to somebody opening the docs page. Generating the document in a test is cheap —
 * no server, no bindings — and it is the only place the REST *conventions* are checked rather than the
 * schemas.
 */
describe("the OpenAPI document", () => {
  // Not cast: `OpenAPISpec` is precise enough to index, and casting it hid nothing worth hiding.
  const spec = OpenApi.fromApi(ApiV1)

  it("is titled and versioned, rather than falling back to the identifier", () => {
    expect(spec.info.title).toBe("effect-ai")
    // The CONTRACT's version. It moves when a v2 is added, not when a commit is deployed — the build
    // is reported by `HealthV1.version`, and conflating the two makes a frozen API look like it moves.
    expect(spec.info.version).toBe("1.0.0")
    expect(spec.info.description).toContain("frozen")
  })

  it("puts every path under the /api/v1 prefix", () => {
    const paths = Object.keys(spec.paths)
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) expect(path.startsWith("/api/v1/")).toBe(true)
  })

  it("names collections in the plural and uses the method the action deserves", () => {
    expect(Object.keys(spec.paths["/api/v1/intakes"] ?? {})).toContain("post")
    expect(Object.keys(spec.paths["/api/v1/health"] ?? {})).toContain("get")
    expect(Object.keys(spec.paths["/api/v1/me"] ?? {})).toContain("get")
  })

  /*
   * The assertion this file was extended for. An upload is stored and enqueued; the decide pipeline runs
   * on a queue afterwards. 200 would tell a caller the work is done, which is the difference between
   * polling for an outcome and assuming there is none — and the response class is called
   * `UploadAcceptedV1`, so a 200 also made the body and the status disagree.
   */
  it("answers 202, not 200, for an upload whose work happens after the response", () => {
    const responses = Object.keys(spec.paths["/api/v1/intakes"]?.post?.responses ?? {})
    expect(responses).toContain("202")
    expect(responses).not.toContain("200")
  })

  it("still declares the typed 415 refusal, which is a feature rather than a framework default", () => {
    expect(Object.keys(spec.paths["/api/v1/intakes"]?.post?.responses ?? {})).toContain("415")
  })
})
