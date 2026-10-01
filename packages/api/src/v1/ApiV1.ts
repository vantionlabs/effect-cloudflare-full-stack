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
import { MessageGroup } from "@ea/modules/chat/domain/Message"
import { RoomGroup } from "@ea/modules/chat/domain/Room"
import { DecisionGroup } from "@ea/modules/decision/domain/Decision"
import { MeGroup } from "@ea/modules/iam/domain/Identity"
import { IntakeGroup } from "@ea/modules/intake/domain/Intake"
import { AskGroup } from "@ea/modules/policy/domain/Ask"
import { UsageGroup } from "@ea/modules/shared/domain/Usage"
import { HttpApi, OpenApi } from "effect/http-api"
import { HealthGroup } from "./Health/HealthWire.ts"

/**
 * The document's own metadata, annotated rather than left to defaults.
 *
 * Without these the generated OpenAPI says `"title": "effect-ai-v1"` and `"version": "0.0.1"` — the
 * identifier and a placeholder — which is what an integrating client sees first and the only part of
 * the document nothing else in the repo would notice was wrong. The version is the CONTRACT's, not the
 * build's: `/api/v1` is frozen, so this string changes when a v2 is added and not when we deploy.
 * `HealthV1.version` is where a commit is reported, and the two must not be conflated.
 */
export const ApiV1 = HttpApi.make("effect-ai-v1")
  .add(HealthGroup)
  .add(MeGroup)
  .add(IntakeGroup)
  .add(DecisionGroup)
  .add(RoomGroup)
  .add(MessageGroup)
  .add(AskGroup)
  .add(UsageGroup)
  .prefix("/api/v1")
  .annotate(OpenApi.Title, "effect-ai")
  .annotate(OpenApi.Version, "1.0.0")
  .annotate(
    OpenApi.Description,
    "Document decisioning: upload a document, and read back a decision with citations somebody can " +
      "audit. Every response under /api/v1 is frozen — fields are added, never renamed or removed.\n\n" +
      "Uploads are asynchronous: POST /api/v1/intakes answers 202 with the ids to read the outcome by, " +
      "because the decide pipeline runs on a queue after the response is written.\n\n" +
      "Authentication: send `X-API-Key: ea_...` (or `Authorization: Bearer ea_...`). Issue a key at " +
      "POST /api/v1/api-keys; the plaintext is returned once and never again. A browser session cookie also " +
      "works, and is what the console uses. A key acts as the member who created it and has that member's " +
      "permissions, so revoking their membership revokes the key."
  )
