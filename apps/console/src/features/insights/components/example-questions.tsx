/**
 * Before the first question: what this page can answer, as questions that work. An empty state that teaches —
 * each one is answerable by the tools behind Insights (activity, quotes, cash planning), so picking one is a real
 * question asked, not a demo.
 */
import { useHydrated } from "@/hooks/use-hydrated"
import { MessageSquareText } from "lucide-react"

const EXAMPLES = [
  "Hoeveel offertes zijn er deze maand gemaakt, en hoeveel daarvan zijn verstuurd?",
  "Hoeveel geld verwachten we de komende vier weken binnen te krijgen?",
  "Hoeveel documenten zijn er deze maand binnengekomen, en hoeveel daarvan moest een mens beoordelen?",
  "Wat zijn de laatste vijf offertes en wat is hun status?"
] as const

export function ExampleQuestions(props: { readonly onPick: (question: string) => void }) {
  const hydrated = useHydrated()
  return (
    <section aria-labelledby="examples-heading" className="flex flex-col gap-2">
      <h2 id="examples-heading" className="text-[13px] font-medium text-ink-2">Waar u bijvoorbeeld naar kunt vragen</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button
              type="button"
              disabled={!hydrated}
              onClick={() => props.onPick(example)}
              className="flex h-full w-full items-start gap-2.5 rounded-card bg-surface p-3 text-left text-[13px] text-ink shadow-card transition-[background-color,transform] duration-150 hover:bg-inset active:scale-[0.99] disabled:opacity-60"
            >
              <MessageSquareText className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
              {example}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
