/**
 * Answers a question about the organization's own data, with every figure traceable to the data.
 *
 * A short tool loop (`DataTools.ts`), then the check: every number in the answer must appear in what the tools
 * returned, in the question, or as today's date (`ungroundedFigures`). An answer that fails is withheld — `answer`
 * null, the untraceable figures named — and the tools' results are returned either way, so the person always has
 * the actual data in front of them.
 *
 * Requires a plain `LanguageModel` with tool calling. The composition supplies the agent's model under that tag:
 * this slice may not import `policy`'s `AgentModel`, and does not need to.
 */
import { DataAnswer, DataLookup, ungroundedFigures } from "@ea/modules/reporting/domain/DataAsk"
import { currentMonth } from "@ea/modules/shared/use-cases/Usage"
import { Effect } from "effect"
import { LanguageModel, Prompt } from "effect/ai"
import { DataToolkit } from "./DataTools.ts"

/** Enough for a lookup, a second lookup with a different period, and an answer. */
const MAX_STEPS = 4

/**
 * The prompt. Its first version had a rule "if the tools do not give what was asked, say so plainly", and the real
 * model over-applied it: asked for this month's figures, it answered that the tools "do not give the number of
 * quotes created this month" and then listed exactly those figures for 2026-10-01..2026-11-01. So the prompt now
 * names this month's exact period and says the field names mean what they say, and the hedge applies only when no
 * returned field corresponds to the question.
 */
const system = (today: string, thisMonth: { readonly from: string; readonly to: string }) =>
  `You answer questions about the organization's own business data for a manager. Today is ${today} (UTC).
"This month" is the period from ${thisMonth.from} to ${thisMonth.to} (the end date is exclusive) — the tools'
default period.

Rules:
- Use the tools to look the figures up, then answer the question DIRECTLY with them.
- The fields mean what their names say: needed_a_person is the number of decisions that needed a person,
  quotes_by_status.sent.count is the number of quotes sent, and so on.
- Every number in your answer must be one the tools returned. Do NOT add, subtract, average or otherwise compute
  new numbers — the tools already give totals and percentages. An answer containing a computed figure is withheld.
- Only if no returned field corresponds to what was asked, say so, and say what the tools do give.
- Answer in one or two sentences, in the language of the question, and mention the period.`

export const AskData = (question: string) =>
  Effect.gen(function*() {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    let prompt = Prompt.make([
      { role: "system", content: system(today, currentMonth(now)) },
      { role: "user", content: [{ type: "text", text: question }] }
    ])
    const data: Array<DataLookup> = []

    for (let step = 1; step <= MAX_STEPS; step++) {
      const response = yield* LanguageModel.generateText({ prompt, toolkit: DataToolkit })
      prompt = Prompt.concat(prompt, Prompt.fromResponseParts(response.content))

      for (const call of response.content) {
        if (call.type !== "tool-call") continue
        const result = response.toolResults.find((part) => part.id === call.id)
        data.push(new DataLookup({ tool: call.name, input: call.params, result: result?.result ?? null }))
      }

      if (!response.content.some((part) => part.type === "tool-call")) {
        const refused = ungroundedFigures(response.text, [
          question,
          today,
          ...data.map((lookup) => JSON.stringify(lookup.result))
        ])
        return new DataAnswer({
          answer: refused.length === 0 ? response.text : null,
          refusedFigures: refused,
          data,
          truncated: false
        })
      }
    }
    // The bound was reached: no answer is given, but everything looked up is still returned.
    return new DataAnswer({ answer: null, refusedFigures: [], data, truncated: true })
  })
