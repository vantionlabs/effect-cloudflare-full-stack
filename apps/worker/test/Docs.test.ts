/**
 * The API's own documentation, served by the real Worker.
 *
 * Both routes here fail silently when they break: a missing docs page is a 404 on a URL nobody on the
 * team visits, and a document that generates but is never mounted looks exactly like one that is. The
 * contract test in `packages/api` asserts what the document SAYS; this asserts that it is reachable and
 * that the Scalar page renders, which is composition-root wiring and cannot be checked without a Worker.
 */
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
  await server.close()
})

describe("GET /api/v1/openapi.json", () => {
  it("serves the generated document, titled and versioned", async () => {
    const response = await server.fetch("/api/v1/openapi.json")
    expect(response.status).toBe(200)

    const spec = await response.json() as {
      readonly info: { readonly title: string; readonly version: string }
      readonly paths: Record<string, unknown>
    }
    expect(spec.info.title).toBe("effect-ai")
    expect(spec.info.version).toBe("1.0.0")
    expect(Object.keys(spec.paths)).toContain("/api/v1/intakes")
  })

  it("is unauthenticated, because a client needs the contract before it has a session", async () => {
    // No cookie. A docs route behind auth is a docs route an integrating client cannot read.
    expect((await server.fetch("/api/v1/openapi.json")).status).toBe(200)
  })
})

describe("GET /api/v1/docs", () => {
  it("renders the Scalar reference", async () => {
    const response = await server.fetch("/api/v1/docs")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")

    const html = await response.text()
    expect(html).toContain("effect-ai")
  })

  /*
   * The CDN choice, asserted. `HttpApiScalar.layer` inlines Scalar's entire bundle into the Worker script,
   * which every cold start then has to load for a page on no hot path. If someone swaps `layerCdn` for
   * `layer`, the page still works and the only visible symptom is a larger script — so the script tag is
   * where that decision is checkable.
   */
  it("loads Scalar from the CDN rather than inlining it into the Worker script", async () => {
    const html = await (await server.fetch("/api/v1/docs")).text()
    expect(html).toContain("cdn.jsdelivr.net")
  })
})
