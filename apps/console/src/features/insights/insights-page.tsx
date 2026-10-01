/**
 * Insights: ask the organization's own data a question, and see the data the answer came from.
 *
 * The answer is shown only if every figure in it can be traced to what the tools returned; otherwise it is withheld
 * and the figures that could not be traced are named. Either way the tools' results are shown underneath — the data
 * is the authority, the prose is a convenience.
 *
 * Each lookup is shown AFTER the answer arrives, as what it returned — not replayed as an animation of steps, which
 * would present finished work as if it were happening live. While the question runs, the page says so and how long
 * it has taken (`LoadingState`), and nothing more, because nothing more is known yet.
 *
 * The question is an RPC mutation from the browser, disabled until hydration. The page has no data of its own to
 * load, so its server render is the empty form.
 */
import { Notice } from "@/components/feedback/notice"
import { Page, PageHeader } from "@/components/layout/page"
import LoadingState from "@/components/primitives/LoadingState"
import { describeFailure } from "@/lib/failure"
import type { DataAnswer } from "@ea/modules/reporting/domain/DataAsk"
import { useAtomSet } from "@effect/atom-react"
import { Exit } from "effect"
import { useState } from "react"
import { askDataAtom } from "./api/insights-atoms.ts"
import { DataAnswerCard } from "./components/data-answer-card.tsx"
import { DataLookupCard } from "./components/data-lookup-card.tsx"
import { QuestionForm } from "./components/question-form.tsx"

export function InsightsPage() {
  const askData = useAtomSet(askDataAtom, { mode: "promiseExit" })
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<DataAnswer | undefined>(undefined)
  const [failed, setFailed] = useState<string | undefined>(undefined)

  const ask = async (question: string) => {
    setAsking(true)
    setFailed(undefined)
    setAnswer(undefined)
    const exit = await askData({ payload: { question } })
    if (Exit.isSuccess(exit)) setAnswer(exit.value)
    else setFailed(describeFailure(exit))
    setAsking(false)
  }

  return (
    <Page>
      <PageHeader
        title="Insights"
        description="Ask about your documents, decisions, quotes and cash. Every figure in an answer comes from your data, shown below it."
      />
      <QuestionForm asking={asking} onAsk={(question) => void ask(question)} />
      {asking ? <LoadingState label="Looking it up" /> : null}
      {failed === undefined ? null : <Notice tone="error">The question could not be answered ({failed}).</Notice>}
      {answer === undefined ? null : (
        <div className="flex flex-col gap-3">
          <DataAnswerCard answer={answer} />
          {answer.data.map((lookup, index) => <DataLookupCard key={index} lookup={lookup} />)}
        </div>
      )}
    </Page>
  )
}
