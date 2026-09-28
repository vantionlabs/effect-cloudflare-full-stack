/**
 * The parsing seam, and its text implementation.
 *
 * One port, three planned adapters:
 *
 *   `.md` / `.txt`        → `TextParser` below. Native, free, no platform needed.
 *   Office / text PDF     → Firecrawl `anydoc` WASM, in-Worker (~4.7 ms median)  [slice 1.5]
 *   Scanned PDF           → Mistral OCR, EU-resident, with bounding boxes        [slice 2]
 *   anything else         → `UnsupportedDocument`
 *
 * A parser's output **defines the verbatim contract**: `source_span` is checked against exactly
 * these bytes, so swapping or upgrading a parser changes what verifies. That makes a parser
 * version an eval concern, not a dependency bump — pin it, and treat a change like an Effect bump.
 */
import { Context, Effect } from "effect"
import { ParsedDocument, UnsupportedDocument } from "./Document.ts"

export interface DocumentParserService {
  readonly parse: (input: {
    readonly bytes: Uint8Array
    readonly contentType: string
    readonly filename: string
  }) => Effect.Effect<ParsedDocument, UnsupportedDocument>
}

export class DocumentParser extends Context.Service<DocumentParser, DocumentParserService>()("intake/DocumentParser") {}

/** Content types the text parser handles. Markdown is text; there is nothing to extract. */
const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown"
])

const TEXT_EXTENSIONS = [".md", ".txt", ".markdown"]

export const SUPPORTED_BY_TEXT_PARSER = [".md", ".txt"] as const

/**
 * Decodes text documents; refuses everything else.
 *
 * `fatal: true` on the decoder is deliberate. The lenient default replaces invalid UTF-8 with
 * U+FFFD, which would silently corrupt the exact bytes a `source_span` is later checked against —
 * a document that *almost* verifies is worse than one that is rejected outright.
 */
export const parseText: DocumentParserService["parse"] = (input) => {
  const lower = input.filename.toLowerCase()
  const looksTextual = TEXT_TYPES.has(input.contentType) ||
    TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension))

  if (!looksTextual) {
    return Effect.fail(
      new UnsupportedDocument({
        filename: input.filename,
        contentType: input.contentType,
        supported: SUPPORTED_BY_TEXT_PARSER
      })
    )
  }

  return Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true }).decode(input.bytes),
    catch: () =>
      new UnsupportedDocument({
        filename: input.filename,
        contentType: input.contentType,
        supported: SUPPORTED_BY_TEXT_PARSER
      })
  }).pipe(
    Effect.map((text) => new ParsedDocument({ text, pageCount: null }))
  )
}
