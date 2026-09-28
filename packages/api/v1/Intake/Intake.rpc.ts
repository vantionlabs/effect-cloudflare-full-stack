/**
 * The intake RPC handlers.
 *
 * `withDatabase` here rather than in the use case: connection lifetime is a per-request concern and
 * `ListIntakes` should be runnable against any client, including the eval harness's.
 */
import { IntakeRpcs } from "@ea/modules/intake/domain/Intake"
import { ListIntakes } from "@ea/modules/intake/use-cases/Intake"
import { withDatabase } from "@ea/modules/shared/tables/Database"
import { Effect } from "effect"

export const IntakeRpcLive = IntakeRpcs.toLayer(
  Effect.succeed({
    "Intake.list": (
      payload: { readonly limit?: number | undefined; readonly collection?: "policy" | "transactional" | undefined }
    ) =>
      // A database failure is not in the contract and a caller can do nothing about it, so it becomes
      // a defect rather than a success-shaped empty list — which would read as "nothing has arrived".
      Effect.orDie(withDatabase(ListIntakes(payload)))
  })
)
