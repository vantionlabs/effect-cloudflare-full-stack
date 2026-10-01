/**
 * Reads the usage report into the figures the page shows. Pure, so the arithmetic is not tangled with markup.
 *
 * Billable units (documents, decisions) and platform cost (tokens, by model) stay apart: one is what a customer is
 * charged for, the other is what the platform pays.
 */
import type { UsageReport } from "@ea/modules/shared/domain/Usage"

export interface ModelTokens {
  readonly model: string
  readonly input: number
  readonly output: number
}

export interface UsageDay {
  readonly day: string
  readonly documents: number
  readonly decisions: number
  readonly tokens: number
}

export const usageFigures = (report: UsageReport) => {
  const total = (meter: string) =>
    report.totals.filter((row) => row.meter === meter).reduce((sum, row) => sum + row.quantity, 0)
  const tokens = (meter: string, model: string) =>
    report.totals.find((row) => row.meter === meter && row.model === model)?.quantity ?? 0
  const daily = (day: string, meter: string) =>
    report.daily.find((row) => row.day === day && row.meter === meter)?.quantity ?? 0

  const models: ReadonlyArray<ModelTokens> = [
    ...new Set(report.totals.flatMap((row) => row.model === null ? [] : [row.model]))
  ].sort().map((model) => ({
    model,
    input: tokens("model.input_tokens", model),
    output: tokens("model.output_tokens", model)
  }))
  const days: ReadonlyArray<UsageDay> = [...new Set(report.daily.map((row) => row.day))].sort().map((day) => ({
    day,
    documents: daily(day, "documents.ingested"),
    decisions: daily(day, "decisions.completed"),
    tokens: daily(day, "model.input_tokens") + daily(day, "model.output_tokens")
  }))

  return {
    documents: total("documents.ingested"),
    decisions: total("decisions.completed"),
    models,
    days
  }
}
