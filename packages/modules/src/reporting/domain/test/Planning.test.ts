/**
 * `planCash` on exact dates. Today is Thursday 2026-10-01, so the first forecast week starts Monday 2026-09-28.
 */
import { OPEN_JOB_DAYS, planCash } from "@ea/modules/reporting/domain/Planning"
import { PAYMENT_TERMS_DAYS } from "@ea/modules/shared/domain/Money"
import { describe, expect, it } from "vitest"

const TODAY = "2026-10-01"
const empty = { openInvoices: [], doneJobs: [], openJobs: [], sentQuotes: [] }

describe("planCash", () => {
  it("starts on this week's Monday and runs twelve weeks", () => {
    const plan = planCash(TODAY, empty)
    expect(plan.weeks[0]!.weekStart).toBe("2026-09-28")
    expect(plan.weeks).toHaveLength(12)
    expect(plan.assumptions).toEqual({ paymentTermsDays: PAYMENT_TERMS_DAYS, openJobDays: OPEN_JOB_DAYS })
  })

  it("expects an open invoice in the week of its due date", () => {
    const plan = planCash(TODAY, { ...empty, openInvoices: [{ amountCents: 50_000, dueOn: "2026-10-14" }] })
    // 2026-10-14 is a Wednesday in the week starting 2026-10-12, the third week.
    expect(plan.weeks[2]).toMatchObject({ weekStart: "2026-10-12", fromInvoices: 50_000, total: 50_000 })
    expect(plan.openInvoices).toEqual({ count: 1, cents: 50_000 })
    expect(plan.overdue).toEqual({ count: 0, cents: 0 })
  })

  it("counts an overdue invoice apart, never in a future week", () => {
    const plan = planCash(TODAY, { ...empty, openInvoices: [{ amountCents: 7_000, dueOn: "2026-09-15" }] })
    expect(plan.overdue).toEqual({ count: 1, cents: 7_000 })
    expect(plan.weeks.reduce((sum, week) => sum + week.total, 0)).toBe(0)
  })

  it("dates a finished, uninvoiced job by the payment terms from today", () => {
    const plan = planCash(TODAY, { ...empty, doneJobs: [{ valueCents: 10_000 }] })
    // 2026-10-01 + 30 days = 2026-10-31, a Saturday, in the week starting 2026-10-26.
    expect(plan.weeks.find((week) => week.weekStart === "2026-10-26")?.fromWork).toBe(10_000)
  })

  it("dates an open job by the assumed finish, then the terms", () => {
    const plan = planCash(TODAY, { ...empty, openJobs: [{ valueCents: 20_000, acceptedOn: "2026-09-30" }] })
    // Finished 2026-10-14, due 2026-11-13, a Friday in the week starting 2026-11-09.
    expect(plan.weeks.find((week) => week.weekStart === "2026-11-09")?.fromWork).toBe(20_000)
    expect(plan.workInProgress.openJobs).toEqual({ count: 1, cents: 20_000 })
  })

  it("never counts sent quotes as expected cash", () => {
    const plan = planCash(TODAY, { ...empty, sentQuotes: [{ totalCents: 99_000 }] })
    expect(plan.pipeline).toEqual({ count: 1, cents: 99_000 })
    expect(plan.weeks.reduce((sum, week) => sum + week.total, 0) + plan.later).toBe(0)
  })

  it("sums what falls beyond twelve weeks as later", () => {
    const plan = planCash(TODAY, { ...empty, openInvoices: [{ amountCents: 1_000, dueOn: "2027-03-01" }] })
    expect(plan.later).toBe(1_000)
  })
})
