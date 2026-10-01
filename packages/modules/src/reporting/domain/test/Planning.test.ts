/**
 * `planCash` on exact dates. Today is Thursday 2026-10-01, so the first forecast week starts Monday 2026-09-28.
 */
import { expenseDates, OPEN_JOB_DAYS, planCash } from "@ea/modules/reporting/domain/Planning"
import { PAYMENT_TERMS_DAYS } from "@ea/modules/shared/domain/Money"
import { describe, expect, it } from "vitest"

const TODAY = "2026-10-01"
const empty = {
  openInvoices: [],
  doneJobs: [],
  openJobs: [],
  sentQuotes: [],
  expenses: [],
  customersWithOwnTerms: 0
}
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const iso = (value: number) => new Date(value).toISOString().slice(0, 10)

describe("planCash", () => {
  it("starts on this week's Monday and runs twelve weeks", () => {
    const plan = planCash(TODAY, empty)
    expect(plan.weeks[0]!.weekStart).toBe("2026-09-28")
    expect(plan.weeks).toHaveLength(12)
    expect(plan.assumptions).toEqual({
      paymentTermsDays: PAYMENT_TERMS_DAYS,
      customersWithOwnTerms: 0,
      openJobDays: OPEN_JOB_DAYS
    })
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
    const plan = planCash(TODAY, { ...empty, doneJobs: [{ valueCents: 10_000, termsDays: PAYMENT_TERMS_DAYS }] })
    // 2026-10-01 + 30 days = 2026-10-31, a Saturday, in the week starting 2026-10-26.
    expect(plan.weeks.find((week) => week.weekStart === "2026-10-26")?.fromWork).toBe(10_000)
  })

  it("dates an open job by the assumed finish, then the terms", () => {
    const plan = planCash(TODAY, {
      ...empty,
      openJobs: [{ valueCents: 20_000, acceptedOn: "2026-09-30", termsDays: PAYMENT_TERMS_DAYS }]
    })
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

  it("uses the customer's own terms for a job", () => {
    const plan = planCash(TODAY, { ...empty, doneJobs: [{ valueCents: 10_000, termsDays: 14 }] })
    // 2026-10-01 + 14 days = 2026-10-15, in the week starting 2026-10-12.
    expect(plan.weeks.find((week) => week.weekStart === "2026-10-12")?.fromWork).toBe(10_000)
  })

  it("subtracts expenses per week and keeps a running net", () => {
    const plan = planCash(TODAY, {
      ...empty,
      openInvoices: [{ amountCents: 50_000, dueOn: "2026-10-14" }],
      expenses: [{ amountCents: 20_000, startsOn: "2026-10-05", repeat: "once", stoppedOn: null }]
    })
    expect(plan.weeks[1]).toMatchObject({ weekStart: "2026-10-05", total: 0, out: 20_000, net: -20_000 })
    expect(plan.weeks[1]!.runningNet).toBe(-20_000)
    expect(plan.weeks[2]).toMatchObject({ total: 50_000, net: 50_000, runningNet: 30_000 })
    expect(plan.weeks.at(-1)!.runningNet).toBe(30_000)
  })

  it("ignores an expense already in the past", () => {
    const plan = planCash(TODAY, {
      ...empty,
      expenses: [{ amountCents: 5_000, startsOn: "2026-09-29", repeat: "once", stoppedOn: null }]
    })
    expect(plan.weeks.reduce((sum, week) => sum + week.out, 0)).toBe(0)
  })
})

describe("expenseDates", () => {
  const window = [ms("2026-10-01"), ms("2027-01-01")] as const

  it("pays a monthly expense on its day, clamped to short months", () => {
    const dates = expenseDates(
      { amountCents: 1, startsOn: "2026-08-31", repeat: "monthly", stoppedOn: null },
      ...window
    )
    expect(dates.map(iso)).toEqual(["2026-10-31", "2026-11-30", "2026-12-31"])
  })

  it("stops paying from the day it was stopped", () => {
    const dates = expenseDates(
      { amountCents: 1, startsOn: "2026-01-15", repeat: "monthly", stoppedOn: "2026-11-15" },
      ...window
    )
    expect(dates.map(iso)).toEqual(["2026-10-15"])
  })

  it("does not pay before a monthly expense starts", () => {
    const dates = expenseDates(
      { amountCents: 1, startsOn: "2026-12-01", repeat: "monthly", stoppedOn: null },
      ...window
    )
    expect(dates.map(iso)).toEqual(["2026-12-01"])
  })
})
