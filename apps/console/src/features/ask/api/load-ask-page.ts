/**
 * The Ask page's SSR data: its query atoms, run on the server and dehydrated — the documents, the person's
 * conversations, and the open conversation's history, so a reload arrives with the whole thread.
 *
 * In a module of its own, importing NOTHING from the atom or RPC graph at the top level: the atoms are imported
 * inside the handler. TanStack Start's compiler analyses every identifier a server function's module references,
 * and when that reached the RPC client on a cold dev server it failed ("could not load module info"), the client
 * entry did not load, and the page never hydrated. A handler body is server-only, so the dynamic import costs the
 * client nothing and leaves the compiler nothing to chase.
 *
 * The registry, mounting and dehydration are `rpc/dehydrate.ts`, shared with every other page.
 */
import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"
import type { AsyncResult, Atom } from "effect/reactivity"

const Input = Schema.Struct({ conversationId: Schema.optional(Schema.String) })

export const loadAskPage = createServerFn({ method: "GET" })
  .inputValidator(Schema.toStandardSchemaV1(Input))
  .handler(async ({ data }) => {
    const { conversationsAtom, historyAtom, knowledgeDocumentsAtom } = await import("./knowledge-atoms.ts")
    const atoms: ReadonlyArray<Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>> = [
      knowledgeDocumentsAtom,
      conversationsAtom,
      ...(data.conversationId === undefined ? [] : [historyAtom(data.conversationId)])
    ]
    const { dehydrateAtoms } = await import("@/rpc/dehydrate")
    return dehydrateAtoms(atoms)
  })
