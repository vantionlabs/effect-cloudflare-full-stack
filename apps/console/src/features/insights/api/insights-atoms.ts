/** Asking the organization's data — a mutation, because each question is something a person does. */
import { Api } from "@/rpc/client"

export const askDataAtom = Api.mutation("Data.ask")
