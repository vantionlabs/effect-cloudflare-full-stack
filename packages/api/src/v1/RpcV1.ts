/**
 * The v1 RPC manifest: every module's `RpcGroup`, merged into one.
 *
 * A manifest and nothing else — no endpoint is declared here. Each slice owns its methods next to the
 * domain types they carry, and this file is the single place that says which slices are exposed in v1.
 * Adding a slice to the product is therefore a one-line diff here, and an unexposed slice is visibly
 * unexposed rather than accidentally absent.
 *
 * Mounted by the composition root as a per-request route (`apps/worker/src/platform/RpcHttp.ts`, ADR-0026), on
 * the *same* router as the HTTP API. One origin, one auth seam, one deploy.
 */
import { MessageRpcs } from "@ea/modules/chat/domain/Message"
import { RoomRpcs } from "@ea/modules/chat/domain/Room"
import { DecisionRpcs } from "@ea/modules/decision/domain/Decision"
import { IdentityRpcs } from "@ea/modules/iam/domain/Identity"
import { IntakeRpcs } from "@ea/modules/intake/domain/Intake"
import { DataRpcs } from "@ea/modules/reporting/domain/DataAsk"
import { PlanningRpcs } from "@ea/modules/reporting/domain/Planning"
import { SalesRpcs } from "@ea/modules/sales/domain/Sales"
import { UsageRpcs } from "@ea/modules/shared/domain/Usage"
/*
 * Imported only so the inferred type of `RpcV1` can be NAMED: `Intake.upload` fails with it, and without an import
 * in scope declaration emit reaches it through `node_modules` and refuses (TS2883). Unused at runtime.
 */
import type { UnsupportedDocument as _UnsupportedDocument } from "@ea/modules/intake/domain/Errors"
import { AskRpcs } from "@ea/modules/policy/domain/Ask"
import { AssistantRpcs } from "@ea/modules/policy/domain/Assistant"

export const RpcV1 = IdentityRpcs.merge(IntakeRpcs).merge(DecisionRpcs).merge(AskRpcs).merge(AssistantRpcs).merge(
  UsageRpcs
)
  .merge(MessageRpcs).merge(RoomRpcs).merge(SalesRpcs).merge(DataRpcs).merge(PlanningRpcs)

/** Where the RPC endpoint is mounted. Exported so the client and the server cannot disagree. */
export const RPC_V1_PATH = "/api/rpc/v1"
