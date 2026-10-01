/**
 * What came back: an answer with its sources, a refusal with its reasons, or a failure.
 *
 * The refusal is not an error. An answer citing something the search did not return is withheld rather than shown,
 * and saying that plainly is the feature — so it sits in the same calm panel as an answer, not in red.
 */
import { Notice } from "@/components/feedback/notice"
import { Panel } from "@/components/layout/page"
import type { AskAnswer } from "@ea/modules/policy/domain/Ask"
import { ShieldCheck, ShieldQuestion } from "lucide-react"
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
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-green" aria-hidden />
              <h2 className="text-[15px] font-semibold text-ink">Antwoord</h2>
            </div>
            {outcome.answer.truncated
              ? <Notice>Het zoeken werd afgebroken, dus dit antwoord kan onvolledig zijn.</Notice>
              : null}
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink" data-testid="answer">
              {outcome.answer.answer}
            </p>
          </Panel>
          {outcome.answer.citations.length === 0
            ? <p className="text-[13px] text-ink-2">Er is geen passage geciteerd.</p>
            : <CitationCards citations={outcome.answer.citations} />}
        </div>
      )
    case "Refused":
      return (
        <Panel className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ShieldQuestion className="size-4 text-orange" aria-hidden />
            <h2 className="text-[15px] font-semibold text-ink">Geen betrouwbaar antwoord</h2>
          </div>
          <p className="text-[13px] text-ink-2">
            Het antwoord citeerde passages die niet konden worden gecontroleerd tegen wat er gevonden is. Een
            onnagaanbare bron laten we liever weg, dus het antwoord is achtergehouden. Probeer de vraag specifieker te
            stellen, of controleer of de juiste handleiding is geüpload.
          </p>
          {/* The reasons are the server's own words, shown as written. */}
          <ul className="list-disc pl-5 text-[13px] text-ink-2">
            {outcome.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </Panel>
      )
    case "Failed":
      return <Notice tone="error">De vraag kon niet worden beantwoord ({outcome.reason}).</Notice>
  }
}
