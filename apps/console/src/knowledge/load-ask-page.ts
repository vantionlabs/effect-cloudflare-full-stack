/**
 * The Ask page's SSR data: its atoms run on the server and dehydrated. See `atoms/dehydrate.ts`.
 *
 * A GET server function, so it always runs on the server — during SSR, and as one call on a client navigation —
 * and so carries no `Origin` requirement (see `auth/auth-client.ts`).
 */
import { dehydrateAtoms } from "@/atoms/dehydrate"
import { createServerFn } from "@tanstack/react-start"
import { knowledgeDocumentsAtom } from "./knowledge-atoms.ts"

export const loadAskPage = createServerFn({ method: "GET" }).handler(() => dehydrateAtoms([knowledgeDocumentsAtom]))
