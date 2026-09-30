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
import {
  ANYDOC_PARSER_VERSION,
  looksUnreadable,
  MIN_PDF_LETTERS,
  SUPPORTED_BY_ANYDOC
} from "@ea/modules/intake/server/Document"
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

describe("looksUnreadable", () => {
  /** A realistic Dutch invoice's worth of markdown, well over the PDF letter floor. */
  const invoice = `# FACTUUR 2026-0042

Leverancier: ACME Kantoorbenodigdheden B.V.
Adres: Keizersgracht 1, 1015 Amsterdam
Inkoopordernummer: PO-9912

| Omschrijving | Aantal | Prijs | Totaal |
| --- | --- | --- | --- |
| Printerpapier A4 wit | 20 | 4,95 | 99,00 |
| Tonercartridge zwart | 2 | 49,50 | 99,00 |

Subtotaal exclusief BTW: EUR 198,00
BTW 21 procent: EUR 41,58
Totaal inclusief BTW: EUR 239,58
Betalingstermijn: 30 dagen na factuurdatum
`

  it("accepts a real invoice", () => {
    expect(looksUnreadable(invoice, "invoice.pdf", "application/pdf")).toBe(false)
  })

  it("refuses an empty conversion", () => {
    // The scanned-PDF case with no text layer at all.
    expect(looksUnreadable("   \n  ", "scan.pdf", "application/pdf")).toBe(true)
  })

  it("refuses text that is mostly replacement characters", () => {
    /*
     * A mis-encoded text layer. This is the case that used to pass: it is not empty, so the old check let
     * it through, and nonsense reached extraction where the rails refused it for the wrong reason.
     */
    const garbled = `${"�".repeat(40)}${invoice.slice(0, 400)}`
    expect(
      looksUnreadable(
        garbled,
        "invoice.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe(true)
  })

  it("tolerates a single replacement character in an otherwise fine document", () => {
    // A ratio rather than a presence check: one bad glyph in a long document is not an unreadable document.
    expect(looksUnreadable(`${invoice}�`, "invoice.pdf", "application/pdf")).toBe(false)
  })

  it("refuses a PDF whose text layer is only a scanner stamp", () => {
    // The realistic middle case: a scanner embedded a header, so the document has text and no content.
    expect(looksUnreadable("Scanned by CanonScan 4200F\nPage 1 of 6", "scan.pdf", "application/pdf")).toBe(true)
  })

  it("does NOT apply the letter floor to a spreadsheet", () => {
    /*
     * The false positive the rule is scoped to avoid. A spreadsheet becomes a markdown TABLE — mostly `|`
     * and `-` and digits — so a general letter-ratio test would refuse a perfectly readable document. The
     * failure lives in PDFs, so the rule does too.
     */
    const table = "| a | b | c |\n| --- | --- | --- |\n| 1,00 | 2,00 | 3,00 |\n| 4,00 | 5,00 | 6,00 |\n"
    expect(looksUnreadable(table, "cijfers.xlsx", "application/vnd.ms-excel")).toBe(false)
    expect(looksUnreadable(table, "cijfers.csv", "text/csv")).toBe(false)
  })

  it("states the PDF letter floor, so the boundary is a decision and not an accident", () => {
    expect(MIN_PDF_LETTERS).toBe(200)
    const justUnder = "a".repeat(MIN_PDF_LETTERS - 1)
    const justOver = "a".repeat(MIN_PDF_LETTERS)
    expect(looksUnreadable(justUnder, "x.pdf", "application/pdf")).toBe(true)
    expect(looksUnreadable(justOver, "x.pdf", "application/pdf")).toBe(false)
  })
})
