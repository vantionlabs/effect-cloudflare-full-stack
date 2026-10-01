/**
 * Ask the technical documentation — the mechanics' assistant. Interface in Dutch (PRODUCT.md).
 *
 * Asking is the `Ask.question` RPC as a mutation, from the browser, because it is a thing the person DOES. There is
 * no plain `fetch` to the backend on this page.
 *
 * The answer is shown with its citations, and that is not decoration: every excerpt was checked against what the
 * search returned before the server answered, and an answer citing something it was not given is refused rather
 * than shown. The assistant is told never to state a pressure, torque or interval it cannot quote.
 *
 * `Ask.question`, not the streaming `Ask.stream`: what that procedure streams is the SEARCHING (the answer arrives
 * once, whole, after its citations are verified), and the console's RPC client speaks plain JSON over HTTP, which
 * delivers a stream's items together when it ends — so the steps would arrive with the answer, not before it.
 * Showing them "live" would be a replay. While waiting, the page shows real elapsed time and nothing invented; the
 * previous answer stays in place, dimmed (`superseded`), because it is stale rather than gone.
 */
import { Page, PageHeader, PageSection } from "@/components/layout/page"
import LoadingState from "@/components/primitives/LoadingState"
import { superseded } from "@/lib/motion"
import { useAtomSet } from "@effect/atom-react"
import { Cause, Exit } from "effect"
import { useState } from "react"
import { askAtom } from "./api/knowledge-atoms.ts"
import { AnswerPanel, type AskOutcome } from "./components/answer-panel.tsx"
import { DocumentationPanel } from "./components/documentation-panel.tsx"
import { QuestionForm } from "./components/question-form.tsx"

export function AskPage() {
  // `promiseExit`, not `promise`: the latter rejects with an Error wrapper whose `_tag` is gone, which rendered
  // every refusal as "unknown error". The Exit keeps the typed failure, so the refusal can be told from a fault.
  const askQuestion = useAtomSet(askAtom, { mode: "promiseExit" })
  const [asking, setAsking] = useState(false)
  const [outcome, setOutcome] = useState<AskOutcome | undefined>(undefined)

  const ask = async (question: string) => {
    setAsking(true)
    const exit = await askQuestion({ payload: { question, collection: "knowledge" } })
    if (Exit.isSuccess(exit)) {
      setOutcome({ _tag: "Answered", answer: exit.value })
    } else {
      // The refusal is a typed failure of the RPC, `UngroundedAnswer`; anything else is a transport fault or defect.
      const failure = Cause.findErrorOption(exit.cause)
      setOutcome(
        failure._tag === "Some" && failure.value._tag === "UngroundedAnswer"
          ? { _tag: "Refused", reasons: failure.value.reasons }
          : { _tag: "Failed", reason: failure._tag === "Some" ? failure.value._tag : Cause.pretty(exit.cause) }
      )
    }
    setAsking(false)
  }

  return (
    <Page width="narrow">
      <PageHeader
        title="Documentatie"
        description="Antwoorden komen alleen uit uw eigen handleidingen en schema's, met de passage waarop ze steunen."
      />
      <QuestionForm asking={asking} onAsk={(question) => void ask(question)} />
      {/* The model is searching; the timer is real elapsed time, nothing about the steps is invented. */}
      {asking ? <LoadingState label="Documentatie doorzoeken" /> : null}
      {outcome === undefined ? null : (
        <div style={superseded(asking)} aria-busy={asking}>
          <AnswerPanel outcome={outcome} />
        </div>
      )}
      <PageSection
        id="documentation"
        title="Documenten"
        description="Handleidingen, schema's en servicebulletins waarin de assistent zoekt."
      >
        <DocumentationPanel />
      </PageSection>
    </Page>
  )
}
