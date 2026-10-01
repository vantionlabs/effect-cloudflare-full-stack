/** The question box. Disabled until hydration, for the reasons in `login-page.tsx`. */
import { Button } from "@/components/atoms/Button"
import { Input } from "@/components/ui/input"
import { useHydrated } from "@/hooks/use-hydrated"
import { useState } from "react"

/** Mirrors the server's own cap, so a long question is cut visibly here rather than silently there. */
const MAX_QUESTION_LENGTH = 2000

export function QuestionForm(props: { readonly asking: boolean; readonly onAsk: (question: string) => void }) {
  const hydrated = useHydrated()
  const [question, setQuestion] = useState("")
  return (
    <form
      method="post"
      className="flex flex-col gap-3 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (question.trim() !== "") props.onAsk(question.slice(0, MAX_QUESTION_LENGTH))
      }}
    >
      <Input
        aria-label="Vraag"
        placeholder="Bijv. wat is de maximale werkdruk van de PK 23.500?"
        value={question}
        maxLength={MAX_QUESTION_LENGTH}
        disabled={!hydrated}
        onChange={(event) => setQuestion(event.target.value)}
        className="h-9"
      />
      <Button
        type="submit"
        variant="primary"
        className="shrink-0"
        disabled={!hydrated || props.asking || question.trim() === ""}
      >
        {props.asking ? "Bezig…" : "Vraag stellen"}
      </Button>
    </form>
  )
}
