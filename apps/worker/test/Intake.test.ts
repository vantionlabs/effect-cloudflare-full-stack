/**
 * Intake, end to end: a real Worker, real R2, real Postgres, a real session.
 *
 * The refusals carry most of the weight again. An upload endpoint that accepts everything and
 * stores a best-effort parse would pass a happy-path test and quietly break the product's central
 * claim, which is that a `source_span` is checked against exactly the bytes we read.
 */
import { UnsupportedDocumentV1, UploadAcceptedV1 } from "@ea/shared-domain/api"
import { Schema } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Harness, startHarness } from "./harness.ts"

let harness: Harness

const upload = (
  options: {
    readonly bytes: Uint8Array | string
    readonly filename: string
    readonly contentType: string
    readonly collection?: string
    readonly cookie?: string
  }
) =>
  harness.fetch(
    `/api/v1/intakes?collection=${options.collection ?? "transactional"}` +
      `&filename=${encodeURIComponent(options.filename)}` +
      `&content_type=${encodeURIComponent(options.contentType)}`,
    {
      method: "POST",
      // Always octet-stream: the body is opaque bytes to the transport, and the document's real
      // media type travels in the query string so the parser owns the refusal.
      headers: {
        "content-type": "application/octet-stream",
        ...(options.cookie === undefined ? {} : { cookie: options.cookie })
      },
      body: options.bytes
    }
  )

beforeAll(async () => {
  harness = await startHarness()
})

afterAll(async () => {
  await harness?.dispose()
})

describe("POST /api/v1/intakes", () => {
  it("registers a markdown document and its intake", async () => {
    const { cookie } = await harness.signedInWithOrg()
    const text = "# Invoice 2026-041\n\nTotal: EUR 1.234,56\n"

    const response = await upload({
      bytes: text,
      filename: "invoice.md",
      contentType: "text/markdown",
      cookie
    })
    expect(response.status).toBe(200)

    const accepted = Schema.decodeUnknownSync(UploadAcceptedV1)(await response.json())
    // Both rows are written in one transaction, so both ids exist or neither does.
    expect(accepted.document_id).not.toBe("")
    expect(accepted.intake_id).not.toBe("")
    expect(accepted.document_id).not.toBe(accepted.intake_id)
    // The parse actually ran — a zero here would mean the bytes never reached the decoder.
    expect(accepted.text_length).toBe(text.length)
  })

  it("accepts the policy collection", async () => {
    // The corpus separation is the product's most important structural guarantee, so the query
    // parameter that selects it has to be honoured rather than defaulted away.
    const { cookie } = await harness.signedInWithOrg()

    const response = await upload({
      bytes: "# Purchasing policy\n\nInvoices above EUR 5.000 require two approvals.\n",
      filename: "policy.md",
      contentType: "text/markdown",
      collection: "policy",
      cookie
    })
    expect(response.status).toBe(200)
  })

  it("refuses a PDF with 415 and names what is supported", async () => {
    const { cookie } = await harness.signedInWithOrg()

    const response = await upload({
      // A real PDF header, so this is a refusal by *format* rather than by unreadable bytes.
      bytes: "%PDF-1.7\n%âãÏÓ\n",
      filename: "scan.pdf",
      contentType: "application/pdf",
      cookie
    })
    expect(response.status).toBe(415)

    const error = Schema.decodeUnknownSync(UnsupportedDocumentV1)(await response.json())
    expect(error.filename).toBe("scan.pdf")
    expect(error.content_type).toBe("application/pdf")
    // Actionable, not merely a rejection: the caller is told what to send instead.
    expect(error.supported).toContain(".md")
  })

  it("refuses bytes that are not valid UTF-8, even with a .md name", async () => {
    // The decoder runs with `fatal: true` on purpose. Lenient decoding substitutes U+FFFD, which
    // would corrupt the exact bytes a `source_span` is later checked against — a document that
    // *almost* verifies is worse than one that is rejected.
    const { cookie } = await harness.signedInWithOrg()

    const response = await upload({
      bytes: new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0x00, 0x80]),
      filename: "broken.md",
      contentType: "text/markdown",
      cookie
    })
    expect(response.status).toBe(415)
  })

  it("401s an unauthenticated upload", async () => {
    // Nothing must be stored for a caller with no identity: `Blobs` keys are org-prefixed, so
    // there is no org to prefix with, and the requirement is in the type via `CurrentUser`.
    const response = await upload({
      bytes: "# hello\n",
      filename: "hello.md",
      contentType: "text/markdown"
    })
    expect(response.status).toBe(401)
  })
})
