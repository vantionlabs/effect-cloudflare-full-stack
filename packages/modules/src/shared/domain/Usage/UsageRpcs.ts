/**
 * Usage over RPC — what the console reads. Domain-shaped (camelCase) like every RPC; the frozen snake_case shape is
 * the v1 HTTP endpoint's, for integrators (`UsageWire.ts`).
 */
import { AuthenticatedRpc } from "@ea/domain/Identity"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { InvalidUsagePeriod } from "../Errors/InvalidUsagePeriod.ts"
import { Meter } from "./Usage.ts"

export class UsageReport extends Schema.Class<UsageReport>("UsageReport")({
  /** Inclusive, UTC. */
  from: Schema.String,
  /** Exclusive, UTC. */
  to: Schema.String,
  totals: Schema.Array(Schema.Struct({ meter: Meter, model: Schema.NullOr(Schema.String), quantity: Schema.Int })),
  daily: Schema.Array(Schema.Struct({ day: Schema.String, meter: Meter, quantity: Schema.Int }))
}) {}

export const UsageRpcs = RpcGroup.make(
  Rpc.make("Usage.report", {
    payload: { from: Schema.optional(Schema.String), to: Schema.optional(Schema.String) },
    success: UsageReport,
    error: InvalidUsagePeriod
  })
).middleware(AuthenticatedRpc)
