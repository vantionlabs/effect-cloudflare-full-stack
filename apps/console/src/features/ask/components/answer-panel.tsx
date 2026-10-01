/**
 * What came back: an answer with its sources, a refusal with its reasons, or a failure.
 *
 * The refusal is not an error. An answer citing something the search did not return is withheld rather than shown,
 * and saying that plainly is the feature.
 */
import { Notice } from "@/components/feedback/notice"
import { Panel } from "@/components/layout/page"
import type { AskAnswer } from "@ea/modules/policy/domain/Ask"
import { CitationCards } from "./citation-cards.tsx"

export type AskOutcome =
  | { readonly _tag: "Answered"; readonly answer: AskAnswer }
  | { readonly _tag: "Refused"; readonly reasons: ReadonlyArray<string> }
  | { readonly _tag: "Failed"; readonly reason: string }

export function AnswerPanel({ outcome }: { readonly outcome: AskOutcome }) {
  switch (outcome._tag) {
    case "Answered":
      return (
        <div className="flex flex-col gap-4">
          <Panel className="flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold text-ink">Answer</h2>
            {outcome.answer.truncated
              ? <Notice>The search was cut short, so this answer may be incomplete.</Notice>
              : null}
            <p className="text-sm whitespace-pre-wrap text-ink" data-testid="answer">{outcome.answer.answer}</p>
          </Panel>
          {outcome.answer.citations.length === 0
            ? <p className="text-[13px] text-ink-2">No passage cited.</p>
            : <CitationCards citations={outcome.answer.citations} />}
        </div>
      )
    case "Refused":
      return (
        <Panel className="flex flex-col gap-2">
          <h2 className="text-[15px] font-semibold text-ink">No reliable answer</h2>
          <p className="text-[13px] text-ink-2">
            The answer cited passages that could not be verified, so it was withheld rather than shown.
          </p>
          <ul className="list-disc pl-5 text-[13px] text-ink-2">
            {outcome.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </Panel>
      )
    case "Failed":
      return <Notice tone="error">The question could not be answered ({outcome.reason}).</Notice>
  }
}
