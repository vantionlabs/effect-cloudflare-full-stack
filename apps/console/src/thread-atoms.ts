/**
 * A decision's thread: the query, the mutation, and the key that ties them to the socket.
 *
 * Same shape as `queue-atoms.ts`, including the part that matters — a family keyed by the subject, built at
 * module scope. `Api.query(...)` called inside a component builds a new atom on every render, which means no
 * cache, a refetch per keystroke elsewhere on the page, and the atom's own loading state thrown away each
 * time. That bug was in this file's neighbour twice before it was noticed.
 */
import { Atom } from "effect/reactivity"
import { Api } from "./rpc.ts"

/** One key per thread, so a message in one decision does not refetch another's. */
export const threadKey = (decisionId: string) => `thread:${decisionId}`

export const threadAtom = Atom.family((decisionId: string) =>
  Api.query(
    "Message.list",
    { subjectKind: "decision" as const, subjectId: decisionId, limit: 200 },
    { reactivityKeys: [threadKey(decisionId)] }
  )
)

export const postMessageAtom = Api.mutation("Message.post")
