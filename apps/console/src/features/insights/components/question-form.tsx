/** The question box. Disabled until hydration: before that, a submit would be the browser's own (see `login.tsx`). */
import { Button } from "@/components/atoms/Button"
import { Input } from "@/components/ui/input"
import { useHydrated } from "@/hooks/use-hydrated"
import { useState } from "react"

export function QuestionForm(props: { readonly asking: boolean; readonly onAsk: (question: string) => void }) {
  const hydrated = useHydrated()
  const [question, setQuestion] = useState("")
  return (
    <form
      method="post"
      className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (question.trim() !== "") props.onAsk(question)
      }}
    >
      <Input
        aria-label="Question"
        placeholder="E.g. how many quotes did we send this month, and for how much?"
        value={question}
        maxLength={1000}
        disabled={!hydrated}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <Button variant="primary" type="submit" disabled={!hydrated || props.asking || question.trim() === ""}>
        {props.asking ? "Looking it up…" : "Ask"}
      </Button>
    </form>
  )
}
