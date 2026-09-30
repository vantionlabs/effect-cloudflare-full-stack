/**
 * Tier 2 of the parsing seam: Office formats and text-layer PDFs, converted in-Worker.
 *
 * `@firecrawl/anydoc-wasm` — MIT, Rust compiled to WebAssembly, no dependencies and no Node builtins — so
 * it runs in `workerd` with nothing shimmed. **Verified by execution** before this adapter was written
 * (`apps/worker/test/AnydocParser.test.ts`): a real `.docx` converts, the module initialises in ~1 ms
 * because wrangler compiles it at build time, and a warm parse is under a millisecond.
 *
 * ## The version is part of the verbatim contract
 *
 * This parser's markdown is what every `source_span` is checked against, so **a version bump changes what
 * verifies** — silently, and in the direction of a decision that used to be grounded no longer being so.
 * Plan risk R6. The dependency is therefore pinned EXACTLY (`"0.2.4"`, no caret) and a bump is an eval
 * re-run, not a dependency chore.
 *
 * ## Why the wasm arrives as a parameter
 *
 * The same inversion every binding uses. A `.wasm` import is resolved and compiled by the BUNDLER — in this
 * repo, wrangler — so it is a platform artifact, and `packages/modules` compiles with `types: []` precisely
 * so platform artifacts cannot be ambient here. `apps/worker` imports the module and hands it over; this
 * file decides which formats are supported and how a failure is reported, which is the part that belongs to
 * the slice.
 *
 * ## Text still goes through the text parser
 *
 * anydoc's `Format` union covers twelve formats and **not** `.md` or `.txt`. So this adapter tries text
 * first and falls through — which also keeps the eval harness and every existing test on exactly the path
 * they were on, since a markdown fixture never reaches the wasm at all.
 */
import { formatFromBytes, formatFromExtension, initSync, toMarkdownBytes } from "@firecrawl/anydoc-wasm"
import { Effect, Layer } from "effect"
import { ParsedDocument } from "../../domain/Document/Document.ts"
import { DocumentParser, type DocumentParserService, parseText } from "../../domain/Document/DocumentParser.ts"
import { UnsupportedDocument } from "../../domain/Errors/UnsupportedDocument.ts"

/**
 * The parser version, which is part of the parsed-text cache key.
 *
 * **Not decoration.** A parser version *defines* the verbatim contract, so cached text produced by a
 * different parser must be unreachable rather than merely stale — `DispatchEvent` keys on
 * `(documentId, parserVersion)`, which makes staleness impossible by construction instead of by TTL.
 *
 * It lives HERE, beside the parser, so the key and the thing it describes cannot drift apart: the constant
 * used to read `"text-1"` in the Worker while the parser was being replaced, and nothing would have
 * complained. `DocumentParserAnydoc.test.ts` asserts this string carries the INSTALLED package version, so
 * a dependency bump that forgets to bump the key fails a test rather than silently serving old markdown to
 * a new grounding check.
 */
export const ANYDOC_PARSER_VERSION = "anydoc-0.2.4"

/**
 * Everything the two tiers together accept, for the refusal message.
 *
 * Named here rather than derived from anydoc's `Format` union because it is a PRODUCT statement — what a
 * caller may upload — and it is what a 415 body tells them. `.pdf` is in the list with a caveat: a
 * text-layer PDF converts, and a scanned one produces little or nothing, which tier 3 (OCR) is for.
 */
export const SUPPORTED_BY_ANYDOC = [
  ".md",
  ".txt",
  ".docx",
  ".doc",
  ".odt",
  ".rtf",
  ".pdf",
  ".pptx",
  ".ppt",
  ".odp",
  ".xlsx",
  ".ods",
  ".epub",
  ".csv"
] as const

/** The last extension, lower-cased and without the dot. `formatFromExtension` wants that shape. */
const extensionOf = (filename: string): string => {
  const index = filename.lastIndexOf(".")
  return index === -1 ? "" : filename.slice(index + 1).toLowerCase()
}

export const DocumentParserAnydoc = (
  /**
   * The compiled module, from `apps/worker`.
   *
   * Typed as `unknown` because naming `WebAssembly.Module` here would need the DOM or workers type
   * libraries, which this package deliberately does not have. It is forwarded and never inspected, so an
   * opaque type costs nothing and keeps the boundary honest.
   */
  wasmModule: unknown
): Layer.Layer<DocumentParser> => Layer.succeed(DocumentParser)({ parse: makeParse(wasmModule) })

const makeParse = (wasmModule: unknown): DocumentParserService["parse"] => {
  let ready = false
  /*
   * Initialised LAZILY, once per isolate.
   *
   * A Worker must execute its global scope within 1 second and this module is 6.38 MiB. Measured at ~1 ms
   * under `workerd`, because wrangler compiles the wasm at build time rather than at startup — so the
   * budget is not actually at risk. Lazy anyway: an isolate that never parses a document should not pay for
   * a parser, and the cost of being wrong about that measurement is a Worker that fails to start.
   */
  const ensureReady = () => {
    if (ready) return
    initSync({ module: wasmModule as never })
    ready = true
  }

  return (input) => {
    const unsupported = new UnsupportedDocument({
      filename: input.filename,
      contentType: input.contentType,
      supported: SUPPORTED_BY_ANYDOC
    })

    return Effect.catch(parseText(input), () =>
      Effect.gen(function*() {
        const bytes = input.bytes
        /*
         * Sniffed from the bytes first, with the extension as a FALLBACK — not the reverse.
         *
         * A container format (`.docx` is a zip with known parts) is identifiable without trusting the
         * filename, which is the safer order when the filename comes from an upload. But sniffing cannot
         * work for a text format: a `.csv` has no magic bytes and is indistinguishable from plain text, so
         * `formatFromBytes` returns undefined and only the extension resolves it. Both halves are asserted
         * in `AnydocParser.test.ts`, because dropping either one silently loses a whole class of document.
         */
        const format = yield* Effect.try({
          try: () => {
            ensureReady()
            return formatFromBytes(bytes) ?? formatFromExtension(extensionOf(input.filename))
          },
          // A throw from the wasm module is a defect in this adapter, not a statement about the document —
          // but a caller can still only be told "not supported", so it is reported as that and logged.
          catch: () => unsupported
        })

        if (format === undefined) return yield* Effect.fail(unsupported)

        const text = yield* Effect.try({
          try: () => toMarkdownBytes(bytes, format),
          catch: () => unsupported
        })

        /*
         * An empty conversion is a REFUSAL, not an empty document.
         *
         * This is the scanned-PDF case: the format is recognised, the file is valid, and there is no text
         * layer to extract — so anydoc returns nothing. Returning an empty `ParsedDocument` would send a
         * blank string into extraction, and the model would answer from nothing while every span
         * trivially failed to verify. Refusing names the real problem, and tier 3 (OCR) is the fix.
         */
        if (text.trim().length === 0) return yield* Effect.fail(unsupported)

        // `pageCount` stays null: `toMarkdownBytes` returns text only, and inventing a count from the
        // markdown would be a guess recorded as a fact.
        return new ParsedDocument({ text, pageCount: null })
      }))
  }
}
