/** The question box. Disabled until hydration: before that, a submit would be the browser's own (see `login-page.tsx`). */
import { Button } from "@/components/atoms/Button"
import { Input } from "@/components/ui/input"
import { useHydrated } from "@/hooks/use-hydrated"

export function QuestionForm(props: {
  readonly question: string
  readonly onQuestionChange: (question: string) => void
  readonly asking: boolean
  readonly onAsk: (question: string) => void
}) {
  const hydrated = useHydrated()
  return (
    <form
      method="post"
      className="flex flex-col gap-3 rounded-card bg-surface p-3 shadow-card sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (props.question.trim() !== "") props.onAsk(props.question)
      }}
    >
      <Input
        aria-label="Vraag"
        placeholder="Bijv. hoeveel offertes hebben we deze maand verstuurd, en voor welk bedrag?"
        value={props.question}
        maxLength={1000}
        disabled={!hydrated}
        onChange={(event) => props.onQuestionChange(event.target.value)}
        className="h-9"
      />
      <Button
        variant="primary"
        type="submit"
        className="shrink-0"
        disabled={!hydrated || props.asking || props.question.trim() === ""}
      >
        {props.asking ? "Bezig…" : "Vraag stellen"}
      </Button>
    </form>
  )
}
