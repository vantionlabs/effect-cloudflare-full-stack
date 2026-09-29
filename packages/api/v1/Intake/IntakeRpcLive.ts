/**
 * The intake RPC handlers.
 *
 * Thin by construction: `serve` carries the two decisions every edge in v1 makes — a per-request
 * connection, and a database failure becoming a defect. See `Serve.ts` for why both belong here rather
 * than in the use case.
 */
import { IntakeRpcs } from "@ea/modules/intake/domain/Intake"
import { ListIntakes } from "@ea/modules/intake/use-cases/Intake"
import { Effect } from "effect"
import { serve } from "../Serve.ts"

export const IntakeRpcLive = IntakeRpcs.toLayer(
  Effect.succeed({
    "Intake.list": (
      payload: { readonly limit?: number | undefined; readonly collection?: "policy" | "transactional" | undefined }
    ) =>
      // `serve` is where the "a database failure is a defect, not a success-shaped empty list" decision
      // lives now — an empty list would read as "nothing has arrived", which is a different fact.
      serve(ListIntakes(payload))
  })
)
