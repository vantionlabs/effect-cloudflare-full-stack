/** Asking the organization's own data a question. Read-only: nothing here can change a record. */
import { AuthenticatedRpc } from "@ea/domain/Identity"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { DataAnswer } from "./DataAnswer.ts"

export const DataRpcs = RpcGroup.make(
  Rpc.make("Data.ask", {
    payload: { question: Schema.String },
    success: DataAnswer
  })
).middleware(AuthenticatedRpc)
