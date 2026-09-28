/**
 * The platform services `HttpApiBuilder` requires, satisfied without a platform package.
 *
 * There is no `@effect/platform-cloudflare`, and `@effect/platform-node` cannot run here.
 * But `HttpApiBuilder.layer` only needs `HttpPlatform`, `Etag.Generator`, `FileSystem` and
 * `Path` — and core ships web-safe implementations of all four:
 *
 * - `HttpPlatform.layer` is already `platform: "web"`.
 * - `FileSystem.layerNoop` is the right answer rather than a compromise: `FileSystem` is
 *   only consulted by `HttpPlatform.fileResponse`, i.e. streaming a file from disk. A
 *   Worker never does that — Workers Assets serves static files before the Worker runs.
 * - `Etag.layerWeak` computes weak ETags without hashing file contents, which is all that
 *   is available when there are no files.
 *
 * Note the shape: `HttpPlatform.layer` *depends on* `FileSystem` and `Etag.Generator`, so
 * they cannot sit beside it in a `Layer.mergeAll` — mergeAll builds in parallel and would
 * leave that dependency unsatisfied. They go underneath via `provideMerge`, which also
 * re-exports them for anything else that needs them.
 */
import { FileSystem, Layer, Path } from "effect"
import { Etag, HttpPlatform } from "effect/http"

const Filesystemless = Layer.mergeAll(FileSystem.layerNoop({}), Etag.layerWeak, Path.layer)

/** Platform services for serving `HttpApi` inside a Worker. No Node, no filesystem. */
export const WorkerPlatform = HttpPlatform.layer.pipe(Layer.provideMerge(Filesystemless))
