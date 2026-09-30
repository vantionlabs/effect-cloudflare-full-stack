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
import { UngroundedAnswer } from "@ea/modules/policy/domain/Errors"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { AskAnswer } from "./AskAnswer.ts"
import { AskProgress } from "./AskProgress.ts"

export const AskRpcs = RpcGroup.make(
  Rpc.make("Ask.question", {
    payload: {
      /** Capped in the handler, not trusted from here — a long question is a long paid prompt. */
      question: Schema.String
    },
    success: AskAnswer,
    /*
     * The refusal. An answer citing a clause it cannot support is refused rather than weakened: the prose relies
     * on the claim, so stripping the citation would leave an assertion a reviewer reads as authoritative and
     * cannot check — which is the failure the decide path's rails exist to prevent.
     */
    error: UngroundedAnswer
  }),
  /*
   * The same question, reporting progress.
   *
   * `stream: true` and the success is `AskProgress`, not a string of tokens — the answer's prose cannot be
   * streamed, because its citations are only checkable once it is complete and streaming text first means an
   * unverifiable claim has been read by the time it is refused. What streams is the searching; the answer
   * arrives once, whole, and verified. See `AskProgress.ts`.
   */
  Rpc.make("Ask.stream", {
    payload: { question: Schema.String },
    success: AskProgress,
    error: UngroundedAnswer,
    stream: true
  })
).middleware(AuthenticatedRpc)
