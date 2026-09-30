/**
 * Tier 3's request shape and its tier-skipping rules, asserted — because there is no key to execute against.
 *
 * Stated plainly rather than implied: no Mistral key exists on this account, so this integration is **not
 * verified by execution**, the same status `cloudflare:sockets` had before milestone 0 and the Workflows
 * memo had before its probe. What assertions can cover is everything that is a decision on our side — the
 * endpoint, the data URI, the pinned model, which formats are worth paying for — and those are exactly the
 * things that would otherwise be discovered by a 422 or an invoice.
 */
import { UnsupportedDocument } from "@ea/modules/intake/domain/Errors"
import {
  MISTRAL_OCR_URL,
  type MistralOcrConfig,
  mistralOcrParse,
  ocrParserVersion,
  ocrRequestBody
} from "@ea/modules/intake/server/Document"
import { Effect, Redacted } from "effect"
import { describe, expect, it } from "vitest"

const config: MistralOcrConfig = {
  apiKey: Redacted.make("key"),
  // Pinned on purpose. `mistral-ocr-latest` is what this repo must never configure.
  model: "mistral-ocr-2508"
}

describe("the request", () => {
  it("posts to the stateless OCR endpoint", () => {
    // Stateless matters legally, not just architecturally: Mistral's Zero Data Retention covers stateless
    // calls only, so the file-upload form of this API would void what ADR-0006 lets us promise (risk R8).
    expect(MISTRAL_OCR_URL).toBe("https://api.mistral.ai/v1/ocr")
  })

  it("sends the document as a data URI, not raw base64", () => {
    /*
     * Mistral answers 422 for base64 without the `data:<mime>;base64,` prefix. The field is typed `string`
     * either way, so nothing but this assertion stands between the right form and an afternoon.
     */
    const body = ocrRequestBody(config, "data:application/pdf;base64,AAAA", false)
    expect(body.document).toEqual({ type: "document_url", document_url: "data:application/pdf;base64,AAAA" })
  })

  it("uses image_url for an image and document_url for a PDF", () => {
    // Mistral distinguishes the two, and sending an image as a document is a 422 rather than a fallback.
    expect(ocrRequestBody(config, "data:image/png;base64,AAAA", true).document).toEqual({
      type: "image_url",
      image_url: "data:image/png;base64,AAAA"
    })
  })

  it("names the pinned model and never a floating tag", () => {
    expect(ocrRequestBody(config, "data:application/pdf;base64,AAAA", false).model).toBe("mistral-ocr-2508")
    expect(ocrRequestBody(config, "x", false).model).not.toContain("latest")
  })

  it("does not ask for the page images back", () => {
    // They would put the document's pixels in a response and a log for no use this adapter has.
    expect(ocrRequestBody(config, "x", false).include_image_base64).toBe(false)
  })
})

describe("the parser version", () => {
  it("names the model, so a model change is a cache-key change", () => {
    // A parser version defines the verbatim contract (risk R6). Two models are two contracts.
    expect(ocrParserVersion(config)).toBe("ocr-mistral-ocr-2508")
    expect(ocrParserVersion({ ...config, model: "other" })).not.toBe(ocrParserVersion(config))
  })
})

describe("when tier 3 is skipped", () => {
  /** A tier-2 stand-in that always refuses, and a spy on whether OCR was attempted. */
  const refusing = (filename: string, contentType: string) => {
    let attempted = false
    const next = () => Effect.fail(new UnsupportedDocument({ filename, contentType, supported: [".md"] }))
    const parse = mistralOcrParse(
      config,
      // Wrapped so the test can tell "tier 2 refused and we stopped" from "tier 2 refused and we paid".
      () => {
        attempted = true
        return next()
      }
    )
    return { parse, attempted: () => attempted }
  }

  it("keeps the earlier refusal for a format OCR cannot help with", async () => {
    /*
     * The cost rule. OCR bills about $4 per 1,000 pages, so it must not be a blanket fallback for anything
     * tier 2 refused — an `.exe` upload becoming a paid API call is the failure mode of a permissive list.
     */
    const { attempted, parse } = refusing("payload.exe", "application/octet-stream")
    const failure = await Effect.runPromise(
      Effect.flip(
        parse({ bytes: new Uint8Array([1, 2, 3]), contentType: "application/octet-stream", filename: "payload.exe" })
      )
    )
    expect(failure._tag).toBe("UnsupportedDocument")
    // The earlier tier's refusal is preserved, so the caller is still told what IS supported.
    expect(failure.supported).toContain(".md")
    expect(attempted()).toBe(true)
  })

  it("recognises a PDF as worth OCR by content type", async () => {
    /*
     * Asserted by the *shape of the failure* rather than by a network call: with no reachable provider the
     * fetch fails, and the adapter maps that to its own refusal naming the OCR formats. So a `supported`
     * list containing `.pdf` means the PDF branch was entered, where `.md` would mean it was not.
     */
    const { parse } = refusing("scan.pdf", "application/pdf")
    const failure = await Effect.runPromise(
      Effect.flip(
        parse({ bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf", filename: "scan.pdf" })
      )
    )
    expect(failure.supported).toContain(".pdf")
  })
})
