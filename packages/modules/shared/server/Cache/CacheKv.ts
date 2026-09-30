/**
 * Cloudflare KV behind the `Cache` port.
 *
 * KV's properties are the reason the port is as narrow as it is: eventually consistent, no atomic
 * primitives, and eviction at the platform's discretion. `Cache.ts` carries the rule that follows from
 * that — **the key must make staleness impossible** — and the table of things which therefore may not be
 * cached, including better-auth sessions and the armed auto-approve rule.
 *
 * Nothing here fails loudly. A `get` that throws, a namespace that is unreachable, a `put` that is
 * rejected: all become a miss or a no-op, because `readThrough` treats the cache as an optimisation and
 * every cached value is derivable from storage. A cache that can take the product down is a worse trade
 * than no cache.
 */
import { Cache, type CacheService } from "@ea/modules/shared/domain/Cache"
import { Effect, Layer } from "effect"

/**
 * The slice of the KV binding this adapter uses.
 *
 * Structural rather than importing `KVNamespace` from `@cloudflare/workers-types`, matching the R2 and
 * Workers AI adapters: it keeps Cloudflare's ambient declarations out of `modules` and out of this file's
 * type surface, so the port stays implementable in Node.
 */
export interface KvNamespaceApi {
  readonly get: (key: string) => Promise<string | null>
  readonly put: (
    key: string,
    value: string,
    options?: { readonly expirationTtl?: number } | undefined
  ) => Promise<void>
}

/**
 * KV's minimum TTL is 60 seconds and it **rejects anything lower**, which is a failure that only shows up
 * at runtime with a live binding — so it is clamped here rather than left to each caller to remember.
 */
const MIN_TTL_SECONDS = 60

export const CacheKv = (namespace: KvNamespaceApi): Layer.Layer<Cache> =>
  Layer.succeed(Cache)(
    {
      get: (key) =>
        Effect.orElseSucceed(
          Effect.tryPromise(() => namespace.get(key)),
          // A miss and a failure are the same thing to a caller: read through. Distinguishing them would
          // only let a caller do something it must not do, which is treat the cache as a store.
          () => null
        ),
      set: (key, value, ttlSeconds) =>
        Effect.ignore(
          Effect.tryPromise(() => namespace.put(key, value, { expirationTtl: Math.max(ttlSeconds, MIN_TTL_SECONDS) }))
        )
    } satisfies CacheService
  )
