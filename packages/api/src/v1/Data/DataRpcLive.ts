/**
 * `Data.ask` — the organization's data, answered with traceable figures. See `reporting/use-cases/DataAsk`.
 *
 * Two things are wired here rather than in the use case, because only the edge may see both slices:
 * - the agent's model (`policy`'s `AgentModel`, which supports tool calling) is supplied under the plain
 *   `LanguageModel` tag the reporting use case asks for;
 * - the toolkit is built per request, inside the tenant scope, so its tools close over this request's connection
 *   and organization.
 */
import { AgentModel } from "@ea/modules/policy/domain/Ask"
import { DataRpcs } from "@ea/modules/reporting/domain/DataAsk"
import { AskData, dataToolkitFor } from "@ea/modules/reporting/use-cases/DataAsk"
import { Effect } from "effect"
import { LanguageModel } from "effect/ai"
import { serveForTenant } from "../Serve.ts"

/** A question, not a document. Capped like the other ask surfaces: a long question is a long paid prompt. */
const MAX_QUESTION_LENGTH = 1000

export const DataRpcLive = DataRpcs.toLayer(
  Effect.succeed({
    "Data.ask": (payload: { readonly question: string }) =>
      serveForTenant(
        Effect.gen(function*() {
          const model = yield* AgentModel
          return yield* AskData(payload.question.slice(0, MAX_QUESTION_LENGTH)).pipe(
            Effect.provide(dataToolkitFor),
            Effect.provideService(LanguageModel.LanguageModel, model)
          )
        })
      ).pipe(
        // A provider failure is a defect: there is nothing in the question for the person to fix.
        Effect.catchTag("AiError", Effect.die)
      )
  })
)
