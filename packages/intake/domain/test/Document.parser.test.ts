/**
 * Parser tests. Pure — no database, no bindings, no network, runs in milliseconds.
 *
 * These matter more than they look: the parser's output defines what a `source_span` is checked
 * against, so "what counts as parseable" is a correctness boundary rather than a convenience.
 */
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { parseText } from "../src/Document/index.ts"

const bytes = (text: string) => new TextEncoder().encode(text)

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(Effect.result(effect))

describe("parseText", () => {
  it("decodes markdown by content type", () => {
    const result = run(
      parseText({ bytes: bytes("# Invoice\n\nTotal: 100"), contentType: "text/markdown", filename: "a.md" })
    )
    expect(result._tag).toBe("Success")
    if (result._tag === "Success") {
      expect(result.success.text).toContain("# Invoice")
      // Markdown has no pages, and saying "1" would be a lie the OCR adapter later contradicts.
      expect(result.success.pageCount).toBeNull()
    }
  })

  it("decodes by extension when the content type is generic", () => {
    // Browsers and curl frequently send application/octet-stream for a .md file.
    const result = run(
      parseText({ bytes: bytes("hello"), contentType: "application/octet-stream", filename: "notes.TXT" })
    )
    expect(result._tag).toBe("Success")
  })

  it("refuses a PDF with a typed error naming what IS supported", () => {
    const result = run(
      parseText({ bytes: bytes("%PDF-1.7"), contentType: "application/pdf", filename: "scan.pdf" })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      const error = result.failure as { _tag: string; supported: ReadonlyArray<string> }
      expect(error._tag).toBe("UnsupportedDocument")
      // Actionable: the caller learns what to send instead, not merely that they failed.
      expect(error.supported).toContain(".md")
    }
  })

  it("refuses invalid UTF-8 rather than silently replacing it", () => {
    // The lenient decoder substitutes U+FFFD, which would corrupt the exact bytes a source_span
    // is later checked against. A document that ALMOST verifies is worse than a rejected one.
    const result = run(
      parseText({ bytes: new Uint8Array([0xff, 0xfe, 0xfd]), contentType: "text/plain", filename: "b.txt" })
    )
    expect(result._tag).toBe("Failure")
  })
})
