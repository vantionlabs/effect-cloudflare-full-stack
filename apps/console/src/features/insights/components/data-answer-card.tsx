/**
 * The answer — or why there is none. An answer is shown only if every figure in it can be traced to what the tools
 * returned (`reporting/domain/DataAsk/GroundedFigures.ts`); otherwise it is withheld and the untraceable figures are
 * named, so the person knows to read the data below instead.
 */
import { Panel } from "@/components/layout/page"
import type { DataAnswer } from "@ea/modules/reporting/domain/DataAsk"

export function DataAnswerCard(props: { readonly answer: DataAnswer }) {
  const { answer } = props
  return (
    <Panel>
      <h2 className="text-[15px] font-semibold text-ink">{answer.answer === null ? "No answer given" : "Answer"}</h2>
      {answer.answer === null
        ? (
          <p className="mt-1 text-[13px] text-ink-2">
            {answer.truncated
              ? "The lookup took too many steps, so no answer was written. The data found is below."
              : `The answer contained figures that are not in your data (${answer.refusedFigures.join(", ")}), ` +
                "so it was withheld. The data itself is below."}
          </p>
        )
        : (
          <p className="mt-2 text-sm whitespace-pre-wrap text-ink" data-testid="data-answer">
            {answer.answer}
          </p>
        )}
    </Panel>
  )
}
