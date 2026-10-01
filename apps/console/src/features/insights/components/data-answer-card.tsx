/**
 * The answer — or why there is none. An answer is shown only if every figure in it can be traced to what the tools
 * returned (`reporting/domain/DataAsk/GroundedFigures.ts`); otherwise it is withheld and the untraceable figures are
 * named.
 *
 * Withholding is a designed outcome, not an error: it is set in the same calm panel as an answer, says plainly what
 * happened and why, and points at the data — which is still there, and still correct.
 */
import { ValuePill } from "@/components/atoms/ValuePill"
import { Panel } from "@/components/layout/page"
import type { DataAnswer } from "@ea/modules/reporting/domain/DataAsk"
import { ShieldCheck, ShieldQuestion } from "lucide-react"

export function DataAnswerCard(props: { readonly question: string; readonly answer: DataAnswer }) {
  const { answer } = props
  const withheld = answer.answer === null
  return (
    <Panel className="flex flex-col gap-2">
      <p className="text-[12px] text-ink-3">{props.question}</p>
      <div className="flex items-center gap-2">
        {withheld
          ? <ShieldQuestion className="size-4 text-orange" aria-hidden />
          : <ShieldCheck className="size-4 text-green" aria-hidden />}
        <h2 className="text-[15px] font-semibold text-ink">{withheld ? "Geen antwoord gegeven" : "Antwoord"}</h2>
      </div>
      {withheld
        ? (
          <div className="flex flex-col gap-1.5 text-[13px] text-ink-2">
            {answer.truncated
              ? <p>Het opzoeken had te veel stappen nodig, dus er is geen antwoord geschreven.</p>
              : (
                <p>
                  Het antwoord noemde getallen die niet in uw gegevens voorkomen
                  {answer.refusedFigures.length === 0 ? null : (
                    <>
                      {" ("}
                      {answer.refusedFigures.map((figure, index) => (
                        <span key={figure}>
                          {index === 0 ? null : " "}
                          <ValuePill tone="orange">{figure}</ValuePill>
                        </span>
                      ))}
                      {")"}
                    </>
                  )}
                  . Een getal dat we niet kunnen herleiden laten we liever weg dan dat u erop vertrouwt, dus het
                  antwoord is achtergehouden.
                </p>
              )}
            <p>De gevonden gegevens staan hieronder en kloppen wel — die kunt u zelf lezen.</p>
          </div>
        )
        : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink" data-testid="data-answer">
            {answer.answer}
          </p>
        )}
      {withheld || answer.data.length === 0 ? null : (
        <p className="text-[12px] text-ink-3">
          Elk getal hierboven komt voor in de {answer.data.length === 1 ? "opzoeking" : "opzoekingen"} hieronder.
        </p>
      )}
    </Panel>
  )
}
