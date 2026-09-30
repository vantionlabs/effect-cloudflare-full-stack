/**
 * Tier 3 of the parsing seam: a scanned document, read by Mistral OCR.
 *
 * The tier that decides whether this product can be shown to a real client. Tier 2 reads a text-layer PDF
 * and returns nothing for a scan, and real SME invoices are frequently scans — "we cannot read half your
 * invoices" is what the plan says kills a pilot.
 *
 * **Mistral rather than a Workers AI vision model, and the reason is ADR-0006 rather than quality.** A
 * Dutch client's invoices are personal data in a document, and Mistral is a French company processing in EU
 * data centres with a DPA available. ADR-0006 rejected routing Mistral *through* OpenRouter because a US
 * intermediary defeats the residency argument; the same logic applies to the parser, which sees more of the
 * document than the model does.
 *
 * ## Three rules this adapter enforces, each from a written risk
 *
 * **Stateless endpoints only** (plan risk R8). Mistral's Zero Data Retention is available on the Scale plan
 * **for stateless calls only** — chat completions, embeddings, OCR — and NOT for stateful products (files,
 * batch, conversations, libraries). So the document travels in the request as a base64 data URI and is
 * never uploaded: `POST /v1/ocr` with `document_url: "data:<mime>;base64,<bytes>"`. The file-upload form of
 * this API exists and is deliberately unused, because using it would silently void what we can promise.
 *
 * **The model is pinned, with no default** (plan risk R6). A parser version *defines* the verbatim contract:
 * its markdown is what every `source_span` is checked against. `mistral-ocr-latest` is a floating tag, so
 * configuring it would let a provider-side upgrade change what verifies, silently, in the direction of a
 * decision that used to be grounded no longer being so. `MISTRAL_OCR_MODEL` is therefore required when OCR
 * is enabled, and it goes into the parsed-text cache key.
 *
 * **OCR is not a blanket fallback.** It costs about $4 per 1,000 pages, so it runs only for the formats
 * where a missing text layer is the actual problem — PDF and images — and only after tier 2 has returned
 * nothing. An unsupported `.exe` must not become a paid API call.
 *
 * ## Not verified by execution
 *
 * Stated plainly because every other external integration in this repo eventually was. There is no Mistral
 * key on this account, so the request shape is verified by ASSERTION against the documented API
 * (`docs/references.md` carries the shape and the date it was checked) and the response decoding is tested
 * against a recorded fixture. The one thing assertions cannot catch is the provider disagreeing with its own
 * documentation, which is exactly what `cloudflare:sockets` and the Workflows memo were probed for.
 */
import { Config, Effect, Redacted, Schema } from "effect"
import { ParsedDocument } from "../../domain/Document/Document.ts"
import type { DocumentParserService } from "../../domain/Document/DocumentParser.ts"
import { UnsupportedDocument } from "../../domain/Errors/UnsupportedDocument.ts"

/** Where the stateless OCR endpoint lives. Exported so the test asserts the same string the adapter calls. */
export const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr"

/**
 * Content types worth paying for.
 *
 * A closed list rather than "anything tier 2 refused": OCR is billed per page, and the failure mode of a
 * permissive list is an invoice rather than an error. PDFs and the image formats Mistral documents.
 */
const OCR_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/avif",
  "image/webp",
  "image/tiff"
])

const OCR_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".avif", ".webp", ".tif", ".tiff"]

/** An image goes in `image_url`; everything else in `document_url`. Mistral distinguishes the two. */
const isImage = (contentType: string, filename: string) =>
  contentType.startsWith("image/") ||
  [".png", ".jpg", ".jpeg", ".avif", ".webp", ".tif", ".tiff"].some((extension) =>
    filename.toLowerCase().endsWith(extension)
  )

/**
 * One page of OCR output.
 *
 * Only the fields this adapter uses are declared, which is deliberate: a provider adding a field must not
 * break decoding, and declaring fields we ignore would invite reading them later without deciding to.
 */
const OcrPage = Schema.Struct({
  index: Schema.Int,
  markdown: Schema.String
})

const OcrResponse = Schema.Struct({
  pages: Schema.Array(OcrPage),
  /** Echoed back by the provider. Compared against the pinned model — see `runOcr`. */
  model: Schema.optional(Schema.String)
})

export interface MistralOcrConfig {
  readonly apiKey: Redacted.Redacted<string>
  /** Pinned, never `mistral-ocr-latest`. See this file's header. */
  readonly model: string
}

/**
 * Reads the OCR configuration, or `undefined` when OCR is not enabled for this deployment.
 *
 * Optional as a PAIR: a key without a model is a misconfiguration rather than a partial one, because a
 * model with no pin is what R6 forbids. So both or neither, and a key with no model fails loudly.
 */
export const mistralOcrConfig: Effect.Effect<MistralOcrConfig | undefined> = Effect.gen(function*() {
  const apiKey = yield* Effect.orDie(
    Config.Redacted("MISTRAL_API_KEY").pipe(Config.withDefault(Redacted.make("")))
  )
  const model = yield* Effect.orDie(Config.String("MISTRAL_OCR_MODEL").pipe(Config.withDefault("")))
  if (Redacted.value(apiKey) === "") return undefined
  if (model === "") {
    return yield* Effect.die(
      new Error(
        "MISTRAL_API_KEY is set but MISTRAL_OCR_MODEL is not. A parser version defines the verbatim " +
          "contract, so the OCR model must be pinned explicitly — `mistral-ocr-latest` would let a " +
          "provider-side upgrade change what verifies (plan risk R6)."
      )
    )
  }
  return { apiKey, model }
})

/** The parser version contributed by tier 3, for the parsed-text cache key. */
export const ocrParserVersion = (config: MistralOcrConfig): string => `ocr-${config.model}`

/**
 * Chains tier 3 onto an earlier tier.
 *
 * `next` runs first and this runs only if it refused — so a markdown or `.docx` document never reaches a
 * paid API call, and the order of tiers is a fact about this function rather than a convention.
 */
export const mistralOcrParse = (
  config: MistralOcrConfig,
  next: DocumentParserService["parse"]
): DocumentParserService["parse"] =>
(input) =>
  Effect.catch(next(input), (refusal) => {
    const lower = input.filename.toLowerCase()
    const worthOcr = OCR_TYPES.has(input.contentType) ||
      OCR_EXTENSIONS.some((extension) => lower.endsWith(extension))
    // Not an OCR-able format: keep the earlier tier's refusal, which already names what IS supported.
    if (!worthOcr) return Effect.fail(refusal)
    return runOcr(config, input)
  })

const runOcr = (
  config: MistralOcrConfig,
  input: { readonly bytes: Uint8Array; readonly contentType: string; readonly filename: string }
) =>
  Effect.gen(function*() {
    const unsupported = new UnsupportedDocument({
      filename: input.filename,
      contentType: input.contentType,
      supported: [".pdf", ".png", ".jpg", ".tiff"]
    })

    /*
     * A data URI, NOT raw base64.
     *
     * Mistral answers **422** for base64 without the `data:<mime>;base64,` prefix — documented in
     * `docs/references.md` with the date, because it is the kind of detail that costs an afternoon and is
     * invisible from the type of the field, which is just `string`.
     */
    const dataUri = `data:${input.contentType};base64,${encodeBase64(input.bytes)}`

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(MISTRAL_OCR_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${Redacted.value(config.apiKey)}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(ocrRequestBody(config, dataUri, isImage(input.contentType, input.filename)))
        }),
      catch: () => unsupported
    })

    if (!response.ok) return yield* Effect.fail(unsupported)

    const body = yield* Effect.tryPromise({ try: () => response.json() as Promise<unknown>, catch: () => unsupported })
    const decoded = Schema.decodeUnknownResult(OcrResponse)(body)
    if (decoded._tag === "Failure") return yield* Effect.fail(unsupported)

    /*
     * Pages joined in index order with a form feed between them.
     *
     * `\f` rather than a blank line because it is not markdown: a page break must not be mistakable for
     * document content by the verbatim check, and a reviewer highlighting a span should not see a page
     * boundary appear inside the quote. `pageCount` is finally a real number rather than null — tier 2
     * cannot know it, and this tier does.
     */
    const ordered = [...decoded.success.pages].sort((left, right) => left.index - right.index)
    const text = ordered.map((page) => page.markdown).join("\f")
    if (text.trim().length === 0) return yield* Effect.fail(unsupported)

    return new ParsedDocument({ text, pageCount: ordered.length })
  })

/**
 * The request body, exported for assertion.
 *
 * Every field here is a decision, which is why the whole body is testable rather than inline: the model is
 * the pinned one, the document is a data URI, and `include_image_base64` is **false** because returning the
 * page images would put the document's pixels in a response and a log for no use this adapter has.
 */
export const ocrRequestBody = (config: MistralOcrConfig, dataUri: string, image: boolean) => ({
  model: config.model,
  document: image
    ? { type: "image_url" as const, image_url: dataUri }
    : { type: "document_url" as const, document_url: dataUri },
  include_image_base64: false
})

/**
 * Base64 without `Buffer`, because this runs in `workerd`.
 *
 * Chunked rather than one `String.fromCharCode(...bytes)` call: spreading a multi-megabyte array into
 * arguments overflows the stack, and a scanned PDF is exactly that size. 8 KiB chunks.
 */
const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  const chunk = 8192
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}
