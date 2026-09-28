/**
 * The v1 RPC manifest: every module's `RpcGroup`, merged into one.
 *
 * A manifest and nothing else — no endpoint is declared here. Each slice owns its methods next to the
 * domain types they carry, and this file is the single place that says which slices are exposed in v1.
 * Adding a slice to the product is therefore a one-line diff here, and an unexposed slice is visibly
 * unexposed rather than accidentally absent.
 *
 * Mounted by the composition root with `RpcServer.layerHttp`, which puts it on the *same* router as the
 * HTTP API. One origin, one auth seam, one deploy.
 */
import { IdentityRpcs } from "@ea/modules/iam/domain/Identity"
import { IntakeRpcs } from "@ea/modules/intake/domain/Intake"

export const RpcV1 = IdentityRpcs.merge(IntakeRpcs)

/** Where the RPC endpoint is mounted. Exported so the client and the server cannot disagree. */
export const RPC_V1_PATH = "/api/rpc/v1"
