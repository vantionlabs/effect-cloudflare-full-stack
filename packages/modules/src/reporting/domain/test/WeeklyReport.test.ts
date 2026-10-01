/**
 * The week the report covers, and what it says. Pure, so every edge is a one-liner.
 */
import { previousWeek, renderWeeklyReport, type WeeklyKpis } from "@ea/modules/reporting/domain/WeeklyReport"
import { describe, expect, it } from "vitest"

describe("previousWeek", () => {
  it("on Monday at 06:00 — when the cron fires — is the whole of the week before, Monday to Monday", () => {
    expect(previousWeek(new Date("2026-10-05T06:00:00Z"))).toEqual({ from: "2026-09-28", to: "2026-10-05" })
  })

  it("never includes the current Monday's first hours, so two reports cannot overlap", () => {
    // 00:30 on Monday is already the new week: the report for it would be next Monday's.
    expect(previousWeek(new Date("2026-10-05T00:30:00Z")).to).toBe("2026-10-05")
  })

  it("on any other day is still the last COMPLETE week", () => {
    expect(previousWeek(new Date("2026-10-01T12:00:00Z"))).toEqual({ from: "2026-09-21", to: "2026-09-28" })
    // Sunday is the end of a week, not the start of one (getUTCDay() === 0).
    expect(previousWeek(new Date("2026-10-04T23:59:00Z"))).toEqual({ from: "2026-09-21", to: "2026-09-28" })
  })
})

describe("renderWeeklyReport", () => {
  const kpis: WeeklyKpis = {
    period: { from: "2026-09-28", to: "2026-10-05" },
    documentsReceived: 12,
    decisions: { total: 8, autoApproved: 2, routedForApproval: 4, rejected: 1, needsHuman: 1 },
    pendingReview: 3,
    tokens: [{ model: "@cf/meta/llama-3.3-70b", input: 12_000, output: 3_400 }]
  }

  it("names the organization and the period in the subject", () => {
    expect(renderWeeklyReport("Been Hydrauliek", kpis).subject).toBe(
      "Been Hydrauliek: weekly figures 2026-09-28 – 2026-10-05"
    )
  })

  it("states every figure with its share of decisions", () => {
    const { text } = renderWeeklyReport("Been Hydrauliek", kpis)
    expect(text).toContain("Documents received:        12")
    expect(text).toContain("approved automatically:  2 (25%)")
    expect(text).toContain("needed a person:         1 (13%)")
    expect(text).toContain("Waiting for review now:    3")
    expect(text).toContain("@cf/meta/llama-3.3-70b: 12,000 / 3,400")
  })

  it("shows a dash rather than 0% or NaN when nothing was decided", () => {
    const { text } = renderWeeklyReport("X", { ...kpis, decisions: { ...kpis.decisions, total: 0, autoApproved: 0 } })
    expect(text).toContain("approved automatically:  0 (—)")
    expect(text).not.toContain("NaN")
  })
})
