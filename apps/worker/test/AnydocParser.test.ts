/**
 * `@firecrawl/anydoc-wasm` in real `workerd`: does the module load, and does it parse a real document?
 *
 * The plan's tier-2 parser depends on this and nothing had tested it. Verified by execution rather than by
 * reading the package, which is how ADR-0009 settled `cloudflare:sockets` and how the Workflows step memo
 * was settled before anything was migrated to it.
 *
 * Gated with the rest of the `worker` project: it boots a real `workerd`.
 */
import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestHarness } from "wrangler"

let server: ReturnType<typeof createTestHarness>

beforeAll(async () => {
  server = createTestHarness({
    workers: [{ configPath: new URL("./fixtures/anydoc/wrangler.jsonc", import.meta.url).pathname }]
  })
  await server.listen()
}, 120_000)

afterAll(async () => {
  await server?.close()
})

interface ParseResult {
  readonly ok: boolean
  readonly error?: string
  readonly initMillis: number
  readonly parseMillis: number
  readonly sniffed: string | null
  readonly format: string | null
  readonly markdown: string
}

const parse = async (file: string, extension: string): Promise<ParseResult> => {
  const bytes = readFileSync(new URL(`./fixtures/anydoc/${file}`, import.meta.url).pathname)
  const response = await server.fetch(`/parse?ext=${extension}`, {
    method: "POST",
    // `as never`: there are two `BodyInit` declarations in play — Node's and workers-types' — and the
    // harness wants its own. The same class of mismatch `Harness.ts` documents for `Response`.
    body: bytes as never
  })
  return await response.json() as ParseResult
}

describe("anydoc under workerd", () => {
  it("initialises from a .wasm import and converts a .docx", async () => {
    const result = await parse("invoice.docx", "docx")
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    // The whole point: a document nobody could read before is now text the pipeline can extract from.
    expect(result.markdown).toContain("FACTUUR 2026-0042")
    expect(result.markdown).toContain("ACME Kantoorbenodigdheden B.V.")
    // The amount has to survive EXACTLY — `source_span` is checked against these bytes, and a parser that
    // reformatted "EUR 1.234,56" would silently change what verifies (plan risk R6).
    expect(result.markdown).toContain("EUR 1.234,56")
  }, 60_000)

  it("sniffs the format from the bytes for a container format", async () => {
    // A .docx is a zip with known parts, so it is identifiable without trusting the filename — which is
    // what makes the extension a fallback rather than the input.
    expect((await parse("invoice.docx", "docx")).sniffed).toBe("docx")
  }, 60_000)

  it("needs the extension for a text format, because sniffing cannot help", async () => {
    /*
     * A CSV has no magic bytes — it is indistinguishable from plain text — so `formatFromBytes` returns
     * undefined and only the extension resolves it. Asserted because it decides the adapter's contract:
     * the filename is load-bearing and cannot be dropped.
     */
    const result = await parse("invoice.csv", "csv")
    expect(result.sniffed).toBeNull()
    expect(result.format).toBe("csv")
    expect(result.markdown).toContain("| factuurnummer | leverancier | totaal |")
  }, 60_000)

  it("initialises well inside the 1-second startup budget", async () => {
    /*
     * 6.38 MiB of wasm against a 1-second cap on a Worker's global scope. It is initialised lazily so the
     * cap does not apply at all, and this records the cost of that first call — the number that would
     * decide whether lazy initialisation is a nicety or a necessity.
     */
    const result = await parse("invoice.docx", "docx")
    expect(result.initMillis).toBeLessThan(1000)
  }, 60_000)
})
