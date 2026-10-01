/**
 * Ask the technical documentation, as a CONVERSATION — the mechanics' assistant. Interface in Dutch (PRODUCT.md).
 *
 * Each conversation is an agent (the Agents SDK, one Durable Object per conversation, ADR-0025) that remembers the
 * turns; the Worker answers and records, and keeps an index row so the person's conversations can be listed. Asking
 * is the `Assistant.ask` RPC as a mutation — the thing the person DOES — and the thread and the list are queries,
 * server-rendered by the route's loader so a reload arrives with the whole conversation.
 *
 * A follow-up gets the earlier turns as context, never as evidence: every citation is still verified against what
 * the search returned for THIS question, and an answer citing anything else is refused rather than shown.
 *
 * `/ask` is a new conversation. Its id is made here, on the first question (a uuid matches the server's
 * `ConversationId` pattern), and once that question is answered the page moves to `/ask/$conversationId`, whose
 * loader brings the recorded turn — so the URL is the conversation from then on and survives a reload.
 */
import { Page, PageHeader, PageSection } from "@/components/layout/page"
import { describeFailure } from "@/lib/failure"
import { superseded } from "@/lib/motion"
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { Cause, Exit, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ChevronDown } from "lucide-react"
import { useState } from "react"
import {
  archiveConversationAtom,
  askInConversationAtom,
  CONVERSATIONS_KEY,
  conversationsAtom,
  historyAtom,
  historyKey
} from "./api/knowledge-atoms.ts"
import { ConversationList } from "./components/conversation-list.tsx"
import { ConversationThread } from "./components/conversation-thread.tsx"
import { DocumentationPanel } from "./components/documentation-panel.tsx"

const ASK_FAILURES = {
  ConversationUnavailable: "Het gesprek kon niet worden bewaard. Je vraag is niet verloren; probeer het opnieuw.",
  RpcClientError: "De verbinding met de server viel weg. Probeer het opnieuw."
}

const newConversationId = () => crypto.randomUUID()

export function AskPage(props: { readonly conversationId: string | undefined }) {
  const { conversationId } = props
  const navigate = useNavigate()
  // `promiseExit`, not `promise`: the latter rejects with an Error wrapper whose `_tag` is gone. The Exit keeps the
  // typed failure, so the refusal — which is recorded as a turn — can be told from a fault.
  const ask = useAtomSet(askInConversationAtom, { mode: "promiseExit" })
  const archive = useAtomSet(archiveConversationAtom, { mode: "promiseExit" })
  const conversations = useAtomValue(conversationsAtom)
  const refreshConversations = useAtomRefresh(conversationsAtom)

  const [pending, setPending] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  // Phones: the list folds away so the conversation comes first; from `md` up it is always beside the thread.
  const [listOpen, setListOpen] = useState(false)

  const onAsk = async (question: string) => {
    const id = conversationId ?? newConversationId()
    setPending(question)
    setFailure(undefined)
    const exit = await ask({
      payload: { conversationId: id, question, collection: "knowledge" },
      reactivityKeys: [historyKey(id), CONVERSATIONS_KEY]
    })
    // A refusal (`UngroundedAnswer`) is not a failure here: it was recorded as a turn, which the refresh shows.
    const refused = Exit.isFailure(exit) && Option.exists(
      Cause.findErrorOption(exit.cause),
      (error) => (error as { readonly _tag?: string })._tag === "UngroundedAnswer"
    )
    if (Exit.isFailure(exit) && !refused) setFailure(describeFailure(exit, ASK_FAILURES))
    refreshConversations()
    if (conversationId === undefined && (Exit.isSuccess(exit) || refused)) {
      await navigate({ to: "/ask/$conversationId", params: { conversationId: id } })
    }
    setPending(undefined)
  }

  const list = AsyncResult.isSuccess(conversations) ? conversations.value : undefined
  const listState = AsyncResult.isFailure(conversations) ? "failed" as const : list

  return (
    <Page width="wide">
      <PageHeader
        title="Documentatie"
        description="Vraag het je eigen handleidingen en schema's. Elk antwoord laat de passage zien waarop het steunt, en je kunt doorvragen."
      />
      <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
        <button
          type="button"
          aria-expanded={listOpen}
          aria-controls="ask-conversations"
          onClick={() => setListOpen((open) => !open)}
          className="flex items-center justify-between rounded-control bg-surface px-3 py-2 text-[13px] font-medium text-ink shadow-card md:hidden"
        >
          Gesprekken{list === undefined ? "" : ` (${list.length})`}
          <ChevronDown
            className="size-4 text-ink-3 transition-transform duration-200"
            style={{ transform: listOpen ? "rotate(180deg)" : "none" }}
            aria-hidden
          />
        </button>
        <div id="ask-conversations" className={listOpen ? "" : "max-md:hidden"}>
          <ConversationList
            conversations={listState}
            activeId={conversationId}
            refreshing={conversations.waiting}
            onArchive={(id) => {
              void archive({ payload: { conversationId: id }, reactivityKeys: [CONVERSATIONS_KEY] }).then(() => {
                if (id === conversationId) void navigate({ to: "/ask" })
              })
            }}
          />
        </div>
        {conversationId === undefined
          ? (
            <ConversationThread
              turns={[]}
              pending={pending}
              failure={failure}
              header={<ThreadTitle title="Nieuw gesprek" />}
              onAsk={(question) => void onAsk(question)}
            />
          )
          : (
            <SavedConversation
              key={conversationId}
              conversationId={conversationId}
              title={list?.find((conversation) => conversation.id === conversationId)?.title}
              pending={pending}
              failure={failure}
              onAsk={(question) => void onAsk(question)}
            />
          )}
      </div>
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

function ThreadTitle(props: { readonly title: string }) {
  return <h2 className="truncate text-[13px] font-medium text-ink">{props.title}</h2>
}

/** A conversation that exists: its history is a query, server-rendered by the loader and refreshed after each ask. */
function SavedConversation(props: {
  readonly conversationId: string
  readonly title: string | undefined
  readonly pending: string | undefined
  readonly failure: string | undefined
  readonly onAsk: (question: string) => void
}) {
  const history = useAtomValue(historyAtom(props.conversationId))
  const turns = AsyncResult.isSuccess(history) ? history.value.turns : []
  /*
   * The asked question stays "pending" until the refreshed history CONTAINS it — otherwise there is a moment between
   * the answer arriving and the refetch landing in which the question would vanish and reappear.
   */
  const recorded = props.pending !== undefined && turns.at(-1)?.question === props.pending
  return (
    <div style={superseded(history.waiting && props.pending === undefined)}>
      {AsyncResult.isFailure(history)
        ? (
          <ConversationThread
            turns={[]}
            pending={undefined}
            failure="Dit gesprek kon niet worden geladen. Probeer de pagina opnieuw te laden."
            header={<ThreadTitle title={props.title ?? "Gesprek"} />}
            onAsk={props.onAsk}
          />
        )
        : (
          <ConversationThread
            turns={turns}
            pending={recorded ? undefined : props.pending}
            failure={props.failure}
            header={<ThreadTitle title={props.title ?? turns[0]?.question ?? "Gesprek"} />}
            onAsk={props.onAsk}
          />
        )}
    </div>
  )
}
