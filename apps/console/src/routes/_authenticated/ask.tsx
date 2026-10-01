/**
 * Ask the technical documentation — the mechanics' assistant.
 *
 * Effect Atom's SSR: the loader runs the documents atom on the server and dehydrates it (`atoms/dehydrate.ts`),
 * and the page reads it with `useAtomValue` inside `HydrationBoundary` — so the HTML arrives listing the manuals
 * and the browser does not fetch them again. Everything goes through the console's own RPC (`rpc.ts`); the public
 * v1 HTTP API is for third parties.
 *
 * Asking and uploading are the `Ask.question` and `Intake.upload` RPCs as mutations, from the browser, because they
 * are things the person DOES. There is no plain `fetch` to the backend on this page. Both controls are disabled
 * until hydration, for the reasons in `login.tsx`.
 *
 * The answer is shown with its citations, and that is not decoration: every excerpt was checked against what the
 * search returned before the server answered, and an answer citing something it was not given is refused rather
 * than shown. The assistant is told never to state a pressure, torque or interval it cannot quote.
 */
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useHydrated } from "@/hooks/use-hydrated"
import { askAtom, knowledgeDocumentsAtom, uploadAtom } from "@/knowledge/knowledge-atoms"
import { loadAskPage } from "@/knowledge/load-ask-page"
import { HydrationBoundary, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"
import { Cause, Exit } from "effect"
import { useState } from "react"

export const Route = createFileRoute("/_authenticated/ask")({
  loader: () => loadAskPage(),
  component: AskRoute
})

function AskRoute() {
  return (
    <HydrationBoundary state={Route.useLoaderData()}>
      <AskPage />
    </HydrationBoundary>
  )
}

interface Answer {
  readonly answer: string
  readonly truncated: boolean
  readonly citations: ReadonlyArray<
    { readonly chunk_id: string; readonly clause_ref: string | null; readonly excerpt: string }
  >
}

type Outcome =
  | { readonly _tag: "Answered"; readonly answer: Answer }
  | { readonly _tag: "Refused"; readonly reasons: ReadonlyArray<string> }
  | { readonly _tag: "Failed"; readonly reason: string }

/** Mirrors the server's own cap, so a long question is cut visibly here rather than silently there. */
const MAX_QUESTION_LENGTH = 2000

function AskPage() {
  const documents = useAtomValue(knowledgeDocumentsAtom)
  const refreshDocuments = useAtomRefresh(knowledgeDocumentsAtom)
  // `promiseExit`, not `promise`: the latter rejects with an Error wrapper whose `_tag` is gone, which rendered
  // every refusal as "unknown error". The Exit keeps the typed failure, so the refusal can be told from a fault.
  const askQuestion = useAtomSet(askAtom, { mode: "promiseExit" })
  const uploadDocument = useAtomSet(uploadAtom, { mode: "promiseExit" })
  const hydrated = useHydrated()
  const [question, setQuestion] = useState("")
  const [asking, setAsking] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined)
  const [uploading, setUploading] = useState(false)
  const [uploadNote, setUploadNote] = useState<string | undefined>(undefined)

  const ask = async () => {
    setAsking(true)
    setOutcome(undefined)
    const exit = await askQuestion({
      payload: { question: question.slice(0, MAX_QUESTION_LENGTH), collection: "knowledge" }
    })
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

  const upload = async (file: File) => {
    setUploading(true)
    setUploadNote(undefined)
    const exit = await uploadDocument({
      payload: {
        filename: file.name,
        contentType: file.type,
        collection: "knowledge",
        bytes: new Uint8Array(await file.arrayBuffer())
      }
    })
    setUploading(false)
    if (Exit.isSuccess(exit)) {
      // Indexing runs on the queue after this answers, so it is searchable shortly — not instantly.
      setUploadNote(`${file.name} uploaded. It becomes searchable once it has been indexed, usually within a minute.`)
      refreshDocuments()
      return
    }
    const failure = Cause.findErrorOption(exit.cause)
    setUploadNote(
      failure._tag === "Some" && failure.value._tag === "UnsupportedDocument"
        ? `${file.name} is not a format that can be read. Try a PDF, Word document, or text file.`
        : `Upload failed (${failure._tag === "Some" ? failure.value._tag : "unexpected error"}).`
    )
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-lg font-medium">Ask the documentation</h1>
        <p className="text-muted-foreground text-sm">
          Answers come only from your manuals and schematics, with the passage they rely on.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form
            method="post"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (question.trim() !== "") void ask()
            }}
          >
            <Input
              aria-label="Question"
              placeholder="Bijv. wat is de maximale werkdruk van de PK 23.500?"
              value={question}
              maxLength={MAX_QUESTION_LENGTH}
              disabled={!hydrated}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <div>
              <Button type="submit" disabled={!hydrated || asking || question.trim() === ""}>
                {asking ? "Searching the documentation…" : "Ask"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {outcome?._tag === "Answered"
        ? (
          <Card>
            <CardHeader>
              <CardTitle>Answer</CardTitle>
              {outcome.answer.truncated
                ? <CardDescription>The search was cut short, so this answer may be incomplete.</CardDescription>
                : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm whitespace-pre-wrap" data-testid="answer">{outcome.answer.answer}</p>
              {outcome.answer.citations.length === 0
                ? <p className="text-muted-foreground text-sm">No passage cited.</p>
                : (
                  <ul className="flex flex-col gap-2" aria-label="Sources">
                    {outcome.answer.citations.map((citation) => (
                      <li key={citation.chunk_id} className="border-l-2 pl-3 text-sm">
                        {citation.clause_ref === null
                          ? null
                          : <span className="font-medium">{citation.clause_ref}:</span>}
                        <q>{citation.excerpt}</q>
                      </li>
                    ))}
                  </ul>
                )}
            </CardContent>
          </Card>
        )
        : null}
      {outcome?._tag === "Refused"
        ? (
          <Card>
            <CardHeader>
              <CardTitle>No reliable answer</CardTitle>
              <CardDescription>
                The answer cited passages that could not be verified, so it was withheld rather than shown.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-muted-foreground list-disc pl-5 text-sm">
                {outcome.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </CardContent>
          </Card>
        )
        : null}
      {outcome?._tag === "Failed"
        ? <p className="text-sm" role="alert">The question could not be answered ({outcome.reason}).</p>
        : null}

      <Card>
        <CardHeader>
          <CardTitle>Documentation</CardTitle>
          <CardDescription>Manuals, schematics and service bulletins the assistant can search.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {documents._tag === "Failure"
            ? <p className="text-sm" role="alert">The document list could not be loaded.</p>
            : documents._tag === "Initial"
            ? <p className="text-muted-foreground text-sm">Loading documentation…</p>
            : documents.value.length === 0
            ? <p className="text-muted-foreground text-sm">No documentation uploaded yet.</p>
            : (
              <ul className="text-sm" aria-label="Documents">
                {documents.value.map((document) => (
                  <li key={document.documentId} className="flex justify-between border-t py-1">
                    <span>{document.filename}</span>
                    <span className="text-muted-foreground tabular-nums">{document.receivedAt.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            )}
          <label className="text-sm">
            <span className="sr-only">Upload documentation</span>
            <input
              type="file"
              disabled={!hydrated || uploading}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file !== undefined) void upload(file)
                event.target.value = ""
              }}
            />
          </label>
          {uploadNote === undefined ? null : <p className="text-sm" role="status">{uploadNote}</p>}
        </CardContent>
      </Card>
    </main>
  )
}
