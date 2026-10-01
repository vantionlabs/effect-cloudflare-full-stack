/**
 * `GET /api/v1/usage`, against a real Worker: a document uploaded through the API shows up as metered usage for
 * the organization that uploaded it, and only for that one.
 *
 * The decide pipeline's meters are asserted in `DecideDocument.test.ts`, where the model can be counted. This
 * file covers what only the edge can: the meter is written by the real upload path, the report is tenant-scoped
 * by the real session, and a malformed period is refused at the boundary instead of summed.
 */
import { UsageReportV1 } from "@ea/modules/shared/domain/Usage"
import { Schema } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type Harness, startHarness } from "./Harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
})

afterAll(async () => {
  await harness?.dispose()
})

const uploadAs = (cookie: string, filename: string) =>
  harness.fetch(
    `/api/v1/intakes?collection=transactional&filename=${filename}&content_type=text%2Fmarkdown`,
    {
      method: "POST",
      headers: { "content-type": "application/octet-stream", cookie },
      body: "# Invoice\n\nTotal: EUR 10,00\n"
    }
  )

const usageAs = (cookie: string, query = "") => harness.fetch(`/api/v1/usage${query}`, { headers: { cookie } })

const ingested = (report: UsageReportV1) =>
  report.totals.find((row) => row.meter === "documents.ingested")?.quantity ?? 0

describe("GET /api/v1/usage", () => {
  it("counts each uploaded document for the uploading organization, in the current month", async () => {
    const { cookie } = await harness.signedInWithOrg()
    expect((await uploadAs(cookie, "a.md")).status).toBe(202)
    expect((await uploadAs(cookie, "b.md")).status).toBe(202)

    const response = await usageAs(cookie)
    expect(response.status).toBe(200)
    const report = Schema.decodeUnknownSync(UsageReportV1)(await response.json())
    expect(ingested(report)).toBe(2)
    // The default period is the current UTC month, and today's uploads are in today's bucket.
    const today = new Date().toISOString().slice(0, 10)
    expect(report.from <= today && today < report.to).toBe(true)
    expect(report.daily).toContainEqual(
      expect.objectContaining({ day: today, meter: "documents.ingested", quantity: 2 })
    )
  })

  it("shows another organization nothing of it", async () => {
    const uploader = await harness.signedInWithOrg()
    await uploadAs(uploader.cookie, "c.md")

    const stranger = await harness.signedInWithOrg()
    const report = Schema.decodeUnknownSync(UsageReportV1)(await (await usageAs(stranger.cookie)).json())
    expect(ingested(report)).toBe(0)
  })

  it("refuses a period that ends before it starts, or spans more than a year", async () => {
    const { cookie } = await harness.signedInWithOrg()
    expect((await usageAs(cookie, "?from=2026-10-01&to=2026-09-01")).status).toBe(400)
    expect((await usageAs(cookie, "?from=2024-01-01&to=2026-01-01")).status).toBe(400)
    expect((await usageAs(cookie, "?from=not-a-day")).status).toBe(400)
  })

  it("requires a credential, like every other v1 read", async () => {
    expect((await harness.fetch("/api/v1/usage")).status).toBe(401)
  })
})
