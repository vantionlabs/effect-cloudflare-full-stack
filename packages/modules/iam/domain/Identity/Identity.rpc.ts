/**
 * The identity RPC contract.
 *
 * **Why RPC exists alongside the HTTP API, and how they differ.** They are not two spellings of one
 * thing; they serve callers with different contracts:
 *
 * | | `HttpApi` (`*.wire.ts`) | `RpcGroup` (`*.rpc.ts`) |
 * | --- | --- | --- |
 * | Caller | anyone — the Laravel client, a customer's script | our own frontend, deployed together |
 * | Schemas | frozen, snake_case, hand-mapped from the domain | **domain types directly**, camelCase |
 * | Breaking changes | never; a v2 is a new path | fine, because client and server ship in one build |
 * | Shape | REST-ish resources, OpenAPI, Scalar docs | methods, batching, streaming |
 *
 * That second row is the whole point. The frozen wire boundary exists so a domain rename cannot break
 * a client we do not control — a real cost, paid in hand-written mappers. Our own frontend *is*
 * controlled, so paying it there would buy nothing and would mean every new field is edited in three
 * places. So RPC uses the domain schemas and the HTTP API keeps its boundary.
 *
 * A rule follows, and `dep:check` will grow to enforce it: a `*.rpc.ts` contract may reference domain
 * types, and a `*.wire.ts` may not re-export one however convenient.
 */
import { AuthenticatedRpc, Identity } from "@ea/modules/shared/domain/Identity"
import { Rpc, RpcGroup } from "effect/rpc"

export const IdentityRpcs = RpcGroup.make(
  // Returns the domain `Identity` as-is. The HTTP twin (`MeV1`) exists because a third party needs a
  // shape that outlives our refactors; our own console does not.
  Rpc.make("Identity.me", { success: Identity })
).middleware(AuthenticatedRpc)
