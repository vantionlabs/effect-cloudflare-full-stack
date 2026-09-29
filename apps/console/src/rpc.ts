/**
 * The console's data layer: the server's own RPC group, bound to atoms.
 *
 * `AtomRpc.Service` takes `RpcV1` — the **same value** the server types its handlers against — so a field
 * renamed on the server is a compile error here rather than an `undefined` at runtime. That is the payoff for
 * RPC carrying domain types instead of a frozen wire shape: the console and the server ship together, so
 * they can share the contract rather than translate across one.
 *
 * There is deliberately no hand-written client, no fetch wrapper and no query-key convention. `query` and
 * `mutation` derive from the group.
 */
import { RPC_V1_PATH, RpcV1 } from "@ea/api/v1"
import { Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { AtomRpc } from "effect/reactivity"
import { RpcClient, RpcSerialization } from "effect/rpc"

export class Api extends AtomRpc.Service<Api>()("console/Api", {
  group: RpcV1,
  protocol: RpcClient.layerProtocolHttp({ url: RPC_V1_PATH }).pipe(
    // JSON, matching the server. Readable in devtools, which for an internal tool is worth more than bytes.
    Layer.provide(Layer.mergeAll(FetchHttpClient.layer, RpcSerialization.layerJson))
  )
}) {}
