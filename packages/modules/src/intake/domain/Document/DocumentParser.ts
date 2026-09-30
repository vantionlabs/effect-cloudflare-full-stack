/**
 * The parsing seam, and its text implementation.
 *
 * One port, three tiers:
 *
 *   `.md` / `.txt`        → `parseText` below. Native, free, no platform needed.              [built]
 *   Office / text PDF     → `DocumentParserAnydoc` in `intake/server`, wasm in-Worker         [built]
 *   Scanned PDF           → Mistral OCR, EU-resident, with bounding boxes                     [tier 3]
 *   anything else         → `UnsupportedDocument`
 *
 * Tier 2 landed 2026-09-30 and **subsumes tier 1 rather than replacing it**: the anydoc adapter tries
 * `parseText` first and falls through, because anydoc's twelve formats do not include `.md` or `.txt`. So a
 * markdown fixture never reaches the wasm, and the eval harness stays on exactly the path it was on.
 *
 * Measured in `workerd`, not estimated: the module initialises in ~1 ms (wrangler compiles the wasm at
 * build time), a `.docx` converts in ~16 ms cold and under 1 ms warm, and the 6.38 MiB module takes the
 * Worker bundle to 16.4 MiB of a 64 MiB limit.
 *
 * **A recognised format with no text is a refusal, not an empty document.** That is the scanned-PDF case:
 * anydoc identifies `pdf` and extracts nothing, and returning an empty `ParsedDocument` would send a blank
 * string into extraction — the model would answer from nothing while every span trivially failed to verify.
 * Tier 3 is what turns that refusal into an answer.
 *
 * A parser's output **defines the verbatim contract**: `source_span` is checked against exactly
 * these bytes, so swapping or upgrading a parser changes what verifies. That makes a parser
 * version an eval concern, not a dependency bump — pin it, and treat a change like an Effect bump.
 */
import { Context, Effect, Layer } from "effect"
import { UnsupportedDocument } from "../Errors/UnsupportedDocument.ts"
import { ParsedDocument } from "./Document.ts"

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

/**
 * The text parser as a layer.
 *
 * Lives in the domain ring with the port, not in `server/`, because it needs no platform at all —
 * a `TextDecoder` is web-standard. So `wrangler dev`, the eval harness and the unit tests all use
 * the same one. When `anydoc` WASM and Mistral OCR arrive they replace this layer for the same
 * tag, from `server/`, and no caller changes.
 */
export const DocumentParserText: Layer.Layer<DocumentParser> = Layer.succeed(DocumentParser)({
  parse: parseText
})
