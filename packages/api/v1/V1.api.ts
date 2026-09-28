/**
 * The versioned public API contract, composed from each slice's own group.
 *
 * One declaration types the server handlers, derives the OpenAPI document and generates the client,
 * so docs cannot drift from the implementation. Everything under `/api/v1` is frozen: endpoints may
 * be added, never changed in place.
 *
 * The groups live with their slices — `IntakeGroup` beside the intake wire schemas it returns — and
 * only the composition is here. That keeps a slice whole (its contract, model and errors in one
 * place) while still giving the browser client and the OpenAPI document a single import.
 */
import { MeGroup } from "@ea/modules/iam/domain/Identity"
import { IntakeGroup } from "@ea/modules/intake/domain/Intake"
import { HttpApi } from "effect/http-api"
import { HealthGroup } from "./Health/Health.wire.ts"

export const ApiV1 = HttpApi.make("effect-ai-v1")
  .add(HealthGroup)
  .add(MeGroup)
  .add(IntakeGroup)
  .prefix("/api/v1")
