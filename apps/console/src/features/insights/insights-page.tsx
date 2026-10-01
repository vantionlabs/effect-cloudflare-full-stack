/**
 * Inzichten: ask the organization's own data a question, and see the data the answer came from.
 *
 * The answer is shown only if every figure in it can be traced to what the tools returned; otherwise it is withheld
 * and the figures that could not be traced are named. Either way the tools' results are shown with it — the data is
 * the authority, the prose is a convenience.
 *
 * Each lookup is shown AFTER the answer arrives, as what it returned — not replayed as an animation of steps, which
 * would present finished work as if it were happening live. While the question runs, the page says so and how long
 * it has taken (`LoadingState`), and nothing more, because nothing more is known yet. The previous answer stays in
 * place, dimmed (`superseded`): it is stale, and saying so is more useful than blanking the page.
 *
 * The question is an RPC mutation from the browser, disabled until hydration. The page has no data of its own to
 * load, so its server render is the empty form with example questions.
 */
import { Notice } from "@/components/feedback/notice"
import { Page, PageHeader } from "@/components/layout/page"
import LoadingState from "@/components/primitives/LoadingState"
import { describeFailure } from "@/lib/failure"
import { superseded } from "@/lib/motion"
import type { DataAnswer } from "@ea/modules/reporting/domain/DataAsk"
import { useAtomSet } from "@effect/atom-react"
import { Exit } from "effect"
import { useState } from "react"
import { askDataAtom } from "./api/insights-atoms.ts"
import { DataAnswerCard } from "./components/data-answer-card.tsx"
import { DataLookups } from "./components/data-lookups.tsx"
import { ExampleQuestions } from "./components/example-questions.tsx"
import { QuestionForm } from "./components/question-form.tsx"

export function InsightsPage() {
  const askData = useAtomSet(askDataAtom, { mode: "promiseExit" })
  const [question, setQuestion] = useState("")
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<{ readonly question: string; readonly result: DataAnswer } | undefined>(
    undefined
  )
  const [failed, setFailed] = useState<string | undefined>(undefined)

  const ask = async (asked: string) => {
    setAsking(true)
    setFailed(undefined)
    const exit = await askData({ payload: { question: asked } })
    if (Exit.isSuccess(exit)) setAnswer({ question: asked, result: exit.value })
    else setFailed(describeFailure(exit))
    setAsking(false)
  }

  return (
    <Page>
      <PageHeader
        title="Inzichten"
        description="Stel een vraag over uw documenten, beslissingen, offertes en geldstromen. Elk getal in een antwoord komt uit uw eigen gegevens, en die gegevens staan erbij."
      />
      <QuestionForm
        question={question}
        onQuestionChange={setQuestion}
        asking={asking}
        onAsk={(asked) => void ask(asked)}
      />
      {asking ? <LoadingState label="Gegevens opzoeken" /> : null}
      {failed === undefined ? null : <Notice tone="error">De vraag kon niet worden beantwoord ({failed}).</Notice>}
      {answer === undefined
        ? (asking ? null : (
          <ExampleQuestions
            onPick={(example) => {
              setQuestion(example)
              void ask(example)
            }}
          />
        ))
        : (
          <div className="flex flex-col gap-4" style={superseded(asking)} aria-busy={asking}>
            <DataAnswerCard question={answer.question} answer={answer.result} />
            <DataLookups lookups={answer.result.data} />
          </div>
        )}
    </Page>
  )
}
