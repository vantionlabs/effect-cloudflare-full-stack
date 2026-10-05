/**
 * An RPC group as a POST route whose server lives and dies with the request it serves.
 *
 * The replacement for `RpcServer.layerHttp`, which forks the server's fiber while the LAYER is built. Here the
 * layer is built lazily, inside whichever request reaches the isolate first (`HttpRouter.toWebHandler`), and a
 * forked fiber does not start on the spot: its first step is queued on the parent fiber's scheduler behind a
 * `setTimeout(0)`. When that first request had no I/O to wait on (`/api/v1/openapi.json`, `/api/v1/docs`, any
 * 404), it returned before the timer fired, workerd dropped the timer with the request, and the server never
 * started. Every later RPC call in the isolate was then written into a buffer nothing drained, and waited for a
 * reply until the runtime cancelled it: "code had hung", 500, within milliseconds. ADR-0026 has the evidence.
 *
 * Built per request with `RpcServer.toHttpEffect`, the server is forked into the REQUEST's scope, so every fiber
 * it starts belongs to the request that is waiting on it, and nothing carries over to the next one. The cost is a
 * handler map and a protocol per call, which is small next to the connection each call already opens.
 *
 * **Streaming procedures need nothing extra**, which is why there is no `Effect.scoped` here. `Effect.scoped`
 * would close the server when the handler returns, and with a framed serialization (NDJSON) that is before a
 * streamed body has been read. The request scope does not have that problem: `toWebHandler` hands it to a streamed
 * body (`HttpEffect.scopeTransferToStream`), so it closes when the last frame is written or the client goes away.
 * With the JSON serialization used today a stream's chunks are collected before the response is built, so the
 * question does not arise yet; it was checked with NDJSON anyway, so switching costs nothing here.
 *
 * The handlers, the middleware and the serialization are read from the context PER REQUEST, so the composition
 * root has to `provideMerge` them rather than `provide`: the same rule as every other route's requirements.
 */
import { Effect } from "effect"
import { HttpRouter } from "effect/http"
import { type Rpc, type RpcGroup, RpcServer } from "effect/rpc"

export const RpcHttp = <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, path: HttpRouter.PathInput) =>
  HttpRouter.add("POST", path, Effect.flatten(RpcServer.toHttpEffect(group)))
