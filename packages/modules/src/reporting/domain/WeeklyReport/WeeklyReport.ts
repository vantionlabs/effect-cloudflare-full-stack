/**
 * The weekly KPI report — "stuurcijfers": the figures a manager steers by, delivered every Monday without asking.
 *
 * This first version reports the PRODUCT's own figures for an organization: what came in, what was decided and
 * how, what is waiting on a person, and what the models cost. A client's own business figures (a workshop's work
 * in progress, its invoicing) arrive later through an integration port; the delivery, the period and the
 * once-per-week guarantee built here are what those will reuse.
 *
 * Pure: the period arithmetic and the rendering are functions of their inputs, so they are tested without a
 * database, a clock or a mail provider.
 */

/** A half-open UTC interval `[from, to)` of whole days, Monday to Monday. */
export interface WeekPeriod {
  readonly from: string
  readonly to: string
}

const DAY_MS = 86_400_000

/**
 * The most recent COMPLETE week before `now`, Monday 00:00 UTC to Monday 00:00 UTC.
 *
 * Complete, not "the last seven days": a report run at 06:00 on Monday must not include Monday's first six hours,
 * or two consecutive reports would overlap and a figure would be counted in both.
 */
export const previousWeek = (now: Date): WeekPeriod => {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  // getUTCDay: Sunday 0 … Saturday 6. Days since this week's Monday.
  const sinceMonday = (now.getUTCDay() + 6) % 7
  const thisMonday = today - sinceMonday * DAY_MS
  const lastMonday = thisMonday - 7 * DAY_MS
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { from: day(lastMonday), to: day(thisMonday) }
}

export interface WeeklyKpis {
  readonly period: WeekPeriod
  readonly documentsReceived: number
  readonly decisions: {
    readonly total: number
    readonly autoApproved: number
    readonly routedForApproval: number
    readonly rejected: number
    readonly needsHuman: number
  }
  /** Waiting on a person NOW, at the time of the report — a backlog, not a weekly count. */
  readonly pendingReview: number
  readonly tokens: ReadonlyArray<{ readonly model: string; readonly input: number; readonly output: number }>
}

const percent = (part: number, whole: number): string => whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`

const number = (value: number): string => value.toLocaleString("en-GB")

/**
 * The email. Plain text first, because the `Email` port requires it and because a list of figures reads perfectly
 * well as text; HTML would add nothing a manager needs.
 *
 * Both rates are shown, and the escalation rate is not framed as something to minimise: per plan risk R1, a
 * FALLING needs-a-person rate is an alarm (weaker grounding sends fewer cases to people) as much as a win. The
 * report states the figures; it does not grade them.
 */
export const renderWeeklyReport = (
  organizationName: string,
  kpis: WeeklyKpis
): { readonly subject: string; readonly text: string } => {
  const d = kpis.decisions
  const lines = [
    `Weekly figures for ${organizationName}`,
    `${kpis.period.from} to ${kpis.period.to} (UTC, end exclusive)`,
    "",
    `Documents received:        ${number(kpis.documentsReceived)}`,
    `Decisions made:            ${number(d.total)}`,
    `  approved automatically:  ${number(d.autoApproved)} (${percent(d.autoApproved, d.total)})`,
    `  sent for approval:       ${number(d.routedForApproval)} (${percent(d.routedForApproval, d.total)})`,
    `  needed a person:         ${number(d.needsHuman)} (${percent(d.needsHuman, d.total)})`,
    `  rejected:                ${number(d.rejected)} (${percent(d.rejected, d.total)})`,
    "",
    `Waiting for review now:    ${number(kpis.pendingReview)}`,
    "",
    kpis.tokens.length === 0 ? "No model calls this week." : "Model usage (tokens in / out):",
    ...kpis.tokens.map((row) => `  ${row.model}: ${number(row.input)} / ${number(row.output)}`)
  ]
  return {
    subject: `${organizationName}: weekly figures ${kpis.period.from} – ${kpis.period.to}`,
    text: lines.join("\n")
  }
}
