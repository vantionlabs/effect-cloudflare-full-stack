/**
 * One exchange in a conversation: the question, then either the answer with its sources or the refusal.
 *
 * A refusal is a turn like any other — calm, in the same column, with what to try next — because withholding an
 * answer whose quotes could not be checked is the product working (PRODUCT.md). The server's own reasons are kept,
 * folded away, for whoever wants to see exactly what failed the check.
 */
import { ChatQuestion } from "@/components/primitives/ChatComposer"
import StreamingText from "@/components/primitives/StreamingText"
import type { AssistantTurn } from "@ea/modules/policy/domain/Assistant"
import { ShieldQuestion } from "lucide-react"
import { CitationCards } from "./citation-cards.tsx"

const TIME = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" })

export function ConversationTurn(props: {
  readonly turn: typeof AssistantTurn.Encoded
  /** The newest answer opens its sources: they are what the reader checks next. */
  readonly latest: boolean
}) {
  const { turn } = props
  const sources = turn.sources ?? []
  return (
    <article className="flex flex-col gap-2" data-testid="conversation-turn" aria-label={`Vraag: ${turn.question}`}>
      <ChatQuestion>{turn.question}</ChatQuestion>
      {turn.answer === undefined
        ? (
          <div className="flex flex-col gap-1.5 rounded-control bg-inset px-3 py-2.5" data-testid="refused-turn">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <ShieldQuestion className="size-4 text-orange" aria-hidden />
              Geen betrouwbaar antwoord
            </div>
            <p className="text-[13px] leading-relaxed text-ink-2">
              Het antwoord citeerde passages die niet te controleren waren tegen wat er gevonden is, dus het is
              achtergehouden. Stel de vraag specifieker, noem het type of onderdeel, of controleer of de juiste
              handleiding is geüpload.
            </p>
            {turn.refusedBecause === undefined || turn.refusedBecause === "" ?
              null :
              (
                <details className="text-[12px] text-ink-3">
                  <summary className="cursor-pointer select-none hover:text-ink-2">Wat de controle vond</summary>
                  <p className="mt-1 whitespace-pre-wrap">{turn.refusedBecause}</p>
                </details>
              )}
          </div>
        )
        : (
          <div data-testid="answer">
            <StreamingText
              // Remounted when it stops being the newest, so only the latest answer keeps its sources open.
              key={props.latest ? "latest" : "earlier"}
              text={turn.answer}
              sourceCount={sources.length}
              sourcesOpen={props.latest}
              sources={<CitationCards citations={sources} />}
              labels={{
                sources: (count) => (count === 1 ? "1 bron" : `${count} bronnen`),
                copy: "Kopiëren",
                copied: "Gekopieerd"
              }}
            />
            {sources.length === 0
              ? <p className="mt-1 text-[12px] text-ink-3">Bij dit antwoord is geen passage geciteerd.</p>
              : null}
          </div>
        )}
      <time className="self-end text-[11px] text-ink-3" dateTime={turn.askedAt}>
        {TIME.format(new Date(turn.askedAt))}
      </time>
    </article>
  )
}
