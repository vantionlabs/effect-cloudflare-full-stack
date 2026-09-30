/**
 * The parser version must name the parser that is actually installed.
 *
 * This is plan risk R6 made mechanical. A parser version *defines* the verbatim contract: its markdown is
 * what every `source_span` is checked against, so bumping `@firecrawl/anydoc-wasm` without bumping
 * `ANYDOC_PARSER_VERSION` would let `DispatchEvent`'s cache serve text the current parser would not produce
 * — and the symptom is a decision that used to be grounded quietly ceasing to be, with nothing logged.
 *
 * A comment cannot catch that. This reads the installed package's own version and compares.
 */
import { ANYDOC_PARSER_VERSION, SUPPORTED_BY_ANYDOC } from "@ea/modules/intake/server/Document"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

const installed = (
  createRequire(import.meta.url)("@firecrawl/anydoc-wasm/package.json") as { readonly version: string }
).version

describe("ANYDOC_PARSER_VERSION", () => {
  it("carries the installed package version", () => {
    // If this fails, a dependency was bumped and the cache key was not. Bump the key, and re-run
    // `bun run evals:retrieval` and the grounding evals before trusting the new parser's output.
    expect(ANYDOC_PARSER_VERSION).toBe(`anydoc-${installed}`)
  })

  it("is pinned exactly, with no range", () => {
    // A caret would let a patch change the verbatim contract on an unrelated install. Asserted on the
    // manifest rather than on the lockfile, because the manifest is what a fresh clone resolves from.
    const manifest = createRequire(import.meta.url)(
      "@ea/modules/package.json"
    ) as { readonly dependencies: Record<string, string> }
    expect(manifest.dependencies["@firecrawl/anydoc-wasm"]).toBe(installed)
  })
})

describe("SUPPORTED_BY_ANYDOC", () => {
  it("still names the text formats, because tier 1 did not go away", () => {
    // The adapter tries `parseText` first and falls through, so a markdown fixture never reaches the wasm.
    // A refusal message that stopped mentioning `.md` would be telling callers something false.
    expect(SUPPORTED_BY_ANYDOC).toContain(".md")
    expect(SUPPORTED_BY_ANYDOC).toContain(".txt")
  })

  it("names the formats the wasm actually converts", () => {
    for (const extension of [".docx", ".pdf", ".xlsx", ".csv", ".rtf", ".epub", ".odt", ".pptx"]) {
      expect(SUPPORTED_BY_ANYDOC, extension).toContain(extension)
    }
  })
})
