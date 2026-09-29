/**
 * Tracing export, when an OTLP endpoint is configured.
 *
 * **The spans already exist.** `Activity` wraps every workflow step in `Effect.withSpan`, `effect/sql`
 * traces queries, `effect/ai`'s `LanguageModel` traces model calls, and `RpcServer` traces requests. Without
 * a `Tracer` they are created and discarded, so this layer is not instrumentation — it is the drain.
 *
 * `effect/observability` is a subpath of core `effect` with **no dependencies**, speaking OTLP over plain
 * HTTP. That is what makes it usable on `workerd`, where the Node-targeted `@opentelemetry/sdk-trace-*`
 * packages are not. `@effect/opentelemetry` exists at the pinned RC and is the wrong tool here: it bridges to
 * the OTel SDK so that OTel *instrumentation libraries* can be reused, and a Worker has none.
 *
 * Optional, and absent means no export rather than an error — the same posture as the AI Gateway. A Worker
 * that refused to start without an observability backend would make telemetry an availability dependency.
 */
import { Layer, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { Otlp, OtlpSerialization } from "effect/observability"

export interface OtlpConfig {
  readonly endpoint: string
  readonly headers: Redacted.Redacted<string> | undefined
  readonly serviceVersion: string | undefined
}

export const TelemetryOtlp = (config: OtlpConfig): Layer.Layer<never> =>
  Otlp.layer({
    baseUrl: config.endpoint,
    resource: {
      serviceName: "effect-ai",
      ...config.serviceVersion === undefined ? {} : { serviceVersion: config.serviceVersion }
    },
    // A single header string (`k=v,k=v`), because that is how every OTLP backend documents its auth and
    // parsing it here beats inventing a second configuration shape.
    ...config.headers === undefined ? {} : {
      headers: Object.fromEntries(
        Redacted.value(config.headers).split(",").map((pair) => {
          const at = pair.indexOf("=")
          return [pair.slice(0, at).trim(), pair.slice(at + 1).trim()] as const
        })
      )
    }
  }).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    /*
     * JSON, not protobuf.
     *
     * Every OTLP backend accepts JSON over HTTP, it is readable in a network trace when the export itself is
     * what is broken, and it avoids carrying a protobuf encoder into a Worker bundle for a payload measured
     * in kilobytes. `layerProtobuf` is there if volume ever makes the size matter.
     */
    Layer.provide(FetchHttpClient.layer)
  )
