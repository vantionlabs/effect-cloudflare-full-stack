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

/** A clause the answer relied on. Verified before it reaches here — see `ungroundedCitations`. */
export class AskAnswerCitation extends Schema.Class<AskAnswerCitation>("AskAnswerCitation")({
  chunk_id: Schema.String,
  clause_ref: Schema.NullOr(Schema.String),
  excerpt: Schema.String
}) {}

export class AskAnswer extends Schema.Class<AskAnswer>("AskAnswer")({
  answer: Schema.String,
  /**
   * The clauses relied on, every one verified against what the search actually returned.
   *
   * Published rather than kept server-side because a reviewer has to be able to check the answer — the same
   * argument as a decision's citations, and the reason this surface was not allowed to stay prose-only. The
   * console can highlight an excerpt with `containsVerbatim`, which is the function that verified it.
   */
  citations: Schema.Array(AskAnswerCitation),
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
    success: AskAnswer,
    /*
     * The refusal. An answer citing a clause it cannot support is refused rather than weakened: the prose relies
     * on the claim, so stripping the citation would leave an assertion a reviewer reads as authoritative and
     * cannot check — which is the failure the decide path's rails exist to prevent.
     */
    error: UngroundedAnswer
  })
).middleware(AuthenticatedRpc)
