/**
 * Insights: ask the organization's own data a question, and see the data the answer came from.
 *
 * The answer is shown only if every figure in it can be traced to what the tools returned (see
 * `reporting/domain/DataAsk/GroundedFigures.ts`); otherwise it is withheld and the figures that could not be traced
 * are named. Either way the tools' results are shown as tables underneath — the data is the authority, the prose
 * is a convenience.
 *
 * The question is an RPC mutation from the browser, disabled until hydration (see `login.tsx`). The page has no
 * data of its own to load, so its server render is the empty form.
 */
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useHydrated } from "@/hooks/use-hydrated"
import { askDataAtom } from "@/insights/insights-atoms"
import { useAtomSet } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"
import { Cause, Exit } from "effect"
import { useState } from "react"

export const Route = createFileRoute("/_authenticated/insights")({ component: InsightsPage })

interface Lookup {
  readonly tool: string
  readonly input: unknown
  readonly result: unknown
}

interface Answer {
  readonly answer: string | null
  readonly refusedFigures: ReadonlyArray<string>
  readonly data: ReadonlyArray<Lookup>
  readonly truncated: boolean
}

const TOOL_TITLES: Record<string, string> = {
  activity_figures: "Activity",
  quote_figures: "Quotes",
  list_quotes: "Recent quotes"
}

const label = (key: string) => key.replaceAll("_", " ")

/** A tool result as tables: nested objects as key/value rows, arrays of objects as a table of rows. */
function Value(props: { readonly value: unknown }) {
  const { value } = props
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">none</span>
    if (typeof value[0] !== "object" || value[0] === null) return <span>{value.join(", ")}</span>
    const columns = Object.keys(value[0] as object)
    return (
      <table className="w-full text-sm">
        <thead className="text-muted-foreground text-left">
          <tr>{columns.map((column) => <th key={column} className="py-1 font-normal">{label(column)}</th>)}</tr>
        </thead>
        <tbody>
          {value.map((row, index) => (
            <tr key={index} className="border-t">
              {columns.map((column) => (
                <td key={column} className="py-1 tabular-nums">{String((row as Record<string, unknown>)[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (typeof value === "object" && value !== null) {
    return (
      <table className="w-full text-sm">
        <tbody>
          {Object.entries(value).map(([key, inner]) => (
            <tr key={key} className="border-t align-top">
              <td className="text-muted-foreground w-1/3 py-1">{label(key)}</td>
              <td className="py-1 tabular-nums">
                <Value value={inner} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return <span>{String(value)}</span>
}

function InsightsPage() {
  const hydrated = useHydrated()
  const askData = useAtomSet(askDataAtom, { mode: "promiseExit" })
  const [question, setQuestion] = useState("")
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<Answer | undefined>(undefined)
  const [failed, setFailed] = useState<string | undefined>(undefined)

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-lg font-medium">Insights</h1>
        <p className="text-muted-foreground text-sm">
          Ask about your documents, decisions and quotes. Every figure in an answer comes from your data, shown below
          it.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form
            method="post"
            className="flex flex-col gap-3"
            onSubmit={async (event) => {
              event.preventDefault()
              if (question.trim() === "") return
              setAsking(true)
              setFailed(undefined)
              setAnswer(undefined)
              const exit = await askData({ payload: { question } })
              if (Exit.isSuccess(exit)) setAnswer(exit.value)
              else setFailed(Cause.pretty(exit.cause).split("\n")[0])
              setAsking(false)
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
            <div>
              <Button type="submit" disabled={!hydrated || asking || question.trim() === ""}>
                {asking ? "Looking it up…" : "Ask"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {failed === undefined
        ? null
        : <p className="text-sm" role="alert">The question could not be answered ({failed}).</p>}

      {answer === undefined ? null : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{answer.answer === null ? "No answer given" : "Answer"}</CardTitle>
              {answer.answer === null
                ? (
                  <CardDescription>
                    {answer.truncated
                      ? "The lookup took too many steps, so no answer was written. The data found is below."
                      : `The answer contained figures that are not in your data (${
                        answer.refusedFigures.join(", ")
                      }), ` +
                        "so it was withheld. The data itself is below."}
                  </CardDescription>
                )
                : null}
            </CardHeader>
            {answer.answer === null ? null : (
              <CardContent>
                <p className="text-sm whitespace-pre-wrap" data-testid="data-answer">{answer.answer}</p>
              </CardContent>
            )}
          </Card>
          {answer.data.map((lookup, index) => (
            <Card key={index} data-testid="data-lookup">
              <CardHeader>
                <CardTitle className="text-base">{TOOL_TITLES[lookup.tool] ?? lookup.tool}</CardTitle>
              </CardHeader>
              <CardContent>
                <Value value={lookup.result} />
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </main>
  )
}
