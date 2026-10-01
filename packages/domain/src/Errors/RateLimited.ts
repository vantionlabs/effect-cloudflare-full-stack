/**
 * An API key is over its quota: **429, with `Retry-After`**, not 401.
 *
 * It used to answer 401, telling an integrator their credential was bad when it was fine — and "fix your
 * credentials" and "back off and retry" have opposite remedies. The likely result was somebody regenerating a
 * working key. `.scratch/api-quota/issues/01` has the history.
 *
 * Only the API-key path raises it. A cookie session is not quota-limited this way, and sharing a status between
 * two unrelated mechanisms would blur both.
 *
 * The wire shape is snake_case like every v1 body, and the wait travels twice on purpose: `Retry-After` because
 * that is what HTTP clients and proxies already honour, and `retry_after_seconds` in the body because that is
 * what a generated client surfaces. Seconds, rounded UP and never below one — better-auth reports milliseconds,
 * and a `Retry-After: 0` invites an immediate retry that will be refused again.
 */
import { Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"

export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  retryAfterSeconds: Schema.Int
}) {}

const RateLimitedBody = Schema.Struct({
  _tag: Schema.tag("RateLimited"),
  message: Schema.String,
  retry_after_seconds: Schema.Int
}).annotate({ identifier: "RateLimitedV1", httpApiStatus: 429 })

/** The error as the v1 contract encodes it: a 429 body plus the `Retry-After` header. */
export const RateLimitedV1 = RateLimited.pipe(
  HttpApiSchema.encodeToWithHeaders({
    body: RateLimitedBody,
    headers: { "retry-after": Schema.FiniteFromString }
  }, {
    decode: ({ body }) => new RateLimited({ retryAfterSeconds: body.retry_after_seconds }),
    encode: (error) => ({
      body: {
        _tag: "RateLimited" as const,
        message: "This API key is over its request quota. Retry after the number of seconds given.",
        retry_after_seconds: error.retryAfterSeconds
      },
      headers: { "retry-after": error.retryAfterSeconds }
    })
  })
)

/** better-auth's `tryAgainIn` is milliseconds; `Retry-After` is whole seconds, at least one. */
export const retryAfterSeconds = (tryAgainInMs: number): number => Math.max(1, Math.ceil(tryAgainInMs / 1000))
