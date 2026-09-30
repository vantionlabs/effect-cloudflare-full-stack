/**
 * The transport edge for decisions: the queue as a collection, and one decision in full.
 *
 * This is the half of the asynchronous contract that `POST /intakes` promises. Its 202 hands back an
 * `intake_id`, and `GET /decisions?intake_id=` is what that id is for.
 */
import { DecisionNotFoundV1 } from "@ea/modules/decision/domain/Decision"
import { GetDecision, ListQueue } from "@ea/modules/decision/use-cases/Decision"
import { clampPageSize } from "@ea/modules/shared/domain/Page"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { ApiV1 } from "../ApiV1.ts"
import { keyset2, page } from "../Page.ts"
import { serveForTenant } from "../Serve.ts"

export const DecisionHttp = HttpApiBuilder.group(
  ApiV1,
  "decisions",
  (handlers) =>
    handlers
      .handle("list", ({ query }) =>
        Effect.gen(function*() {
          const after = yield* keyset2(query.cursor)
          const limit = clampPageSize(query.limit)
          const items = yield* serveForTenant(
            ListQueue({
              limit,
              ...after === undefined ? {} : { after },
              ...query.intake_id === undefined ? {} : { intakeId: query.intake_id }
            })
          )
          // The keyset must match the ORDER the use case returns, which for the queue is oldest-first by
          // `decided_at` and then by id. Getting this wrong pages from the wrong row rather than failing.
          return page(items, limit, (item) => [item.decidedAt, item.decisionId])
        }))
      .handle("get", ({ params }) =>
        Effect.flatMap(
          serveForTenant(GetDecision({ decisionId: params.decisionId })),
          (detail) =>
            /*
             * `GetDecision` answers null for "not in your organization" AND for "does not exist", and the edge
             * keeps them indistinguishable. Telling them apart would make the endpoint an oracle for whether an
             * id exists in somebody else's account.
             */
            detail === null
              ? Effect.fail(new DecisionNotFoundV1({ decision_id: params.decisionId }))
              : Effect.succeed(detail)
        ))
)
