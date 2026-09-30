/**
 * The reviewer Q&A surface.
 *
 * RPC only, and **not** part of the public `HttpApi`. That is a product decision rather than an omission: the
 * v1 HTTP API is a frozen contract a third party compiles against, and an agent's behaviour is the least
 * stable thing in the system — its prompt, its tool set and its step bound will all change. Freezing a shape
 * around it would promise stability we cannot give. The console is our own caller and moves with the server.
 *
 * Note what the payload does NOT carry: an organization. The tenant comes from the session, and the model
 * never gets to influence it — see `AskCorpus.ts` for why that is the security-relevant property here.
 */
import { AuthenticatedRpc } from "@ea/domain/Identity"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

export class AskAnswer extends Schema.Class<AskAnswer>("AskAnswer")({
  answer: Schema.String,
  /** How many model calls it took. Surfaced so a loop that always hits its bound is visible in the UI. */
  steps: Schema.Int,
  /** True when the step bound stopped it. The answer is then partial and the console must say so. */
  truncated: Schema.Boolean
}) {}

export const AskRpcs = RpcGroup.make(
  Rpc.make("Ask.question", {
    payload: {
      /** Capped in the handler, not trusted from here — a long question is a long paid prompt. */
      question: Schema.String
    },
    success: AskAnswer
  })
).middleware(AuthenticatedRpc)
