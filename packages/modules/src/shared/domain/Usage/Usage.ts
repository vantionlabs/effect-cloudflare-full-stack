/**
 * Usage metering: what an organization consumed, as countable units.
 *
 * Exists for resale. A product sold per organization has to be able to say what each one used, and a figure
 * reconstructed after the fact from logs or Analytics Engine is not one anybody should invoice from — Analytics
 * Engine SAMPLES at volume, and logs expire. So meters are rows in Postgres, written **in the same transaction
 * as the work they count**: a document's meter commits with its intake row, a decision's with the decision claim.
 * A count therefore cannot disagree with what was stored.
 *
 * ## Two kinds of meter, and why they are treated differently
 *
 * - **Billable units** — documents ingested, decisions completed. What a customer would be charged for. Each
 *   carries a DERIVED idempotency key (`intake:<id>`, `decide:<key>`), so a retried Workflow step or a
 *   redelivered message cannot count the same unit twice.
 * - **Cost** — model tokens, labelled by model. What WE pay. No idempotency key: if a step genuinely re-runs a
 *   model call, that was real spend and must show.
 *
 * The vocabulary is CLOSED, here and as a `check` constraint on the table. A meter nobody declared is a number
 * nobody can price, so adding one is a deliberate change in two places rather than a string somebody typed.
 */
import { Schema } from "effect"
import type { LanguageModel } from "effect/ai"

export const Meter = Schema.Literals([
  "documents.ingested",
  "decisions.completed",
  "model.input_tokens",
  "model.output_tokens"
])
export type Meter = typeof Meter.Type

export interface UsageEntry {
  readonly meter: Meter
  /** A positive whole number. Zero is not recorded: a meter row means something was consumed. */
  readonly quantity: number
  /** For model meters, which model. Null for everything else. */
  readonly model?: string | null | undefined
  /** What was consumed — a document id, a decision id. For tracing a charge back to the work. */
  readonly subjectId?: string | null | undefined
  /** Set for billable units, derived from the unit's own id. See the module note. */
  readonly idempotencyKey?: string | null | undefined
}

/** What one model call cost, read off its response. */
export interface ModelUsage {
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
}

/**
 * Reads the model and token totals off a response, or `undefined` when the response does not report them.
 *
 * The model comes from the `response-metadata` part the adapter writes, because the completion body does not
 * echo it. A response without usage — the scripted model in tests, a provider that omits it — is `undefined`
 * rather than zeros: "not reported" and "free" are different facts, and a zero row would claim the second.
 */
export const modelUsageOf = (
  response: Pick<LanguageModel.GenerateTextResponse<{}>, "content" | "usage">
): ModelUsage | undefined => {
  const metadata = response.content.find((part) => part.type === "response-metadata")
  const model = metadata?.type === "response-metadata" ? metadata.modelId : undefined
  const inputTokens = response.usage.inputTokens.total
  const outputTokens = response.usage.outputTokens.total
  if (model === undefined || inputTokens === undefined || outputTokens === undefined) return undefined
  return { model, inputTokens, outputTokens }
}

/** The cost entries for one model call. */
export const modelUsageEntries = (usage: ModelUsage | undefined): ReadonlyArray<UsageEntry> =>
  usage === undefined ? [] : [
    { meter: "model.input_tokens", quantity: usage.inputTokens, model: usage.model },
    { meter: "model.output_tokens", quantity: usage.outputTokens, model: usage.model }
  ]
