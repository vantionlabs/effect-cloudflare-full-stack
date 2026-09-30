/**
 * A read-through cache for values that **cannot go stale**, as a port.
 *
 * Narrow on purpose: `get`, `set`, and nothing else. No delete, no increment, no compare-and-set — and the
 * absence of those is the design, not an omission. The adapter is Cloudflare KV, which is eventually
 * consistent and has **no atomic primitives**, so anything whose correctness depends on invalidation or on
 * a read-modify-write cannot live here.
 *
 * ## The rule for what may be cached
 *
 * **The key must make staleness impossible.** Not unlikely — impossible. If a value can change while its
 * key stays the same, it does not belong in this cache, because there is no invalidation and a stale read
 * will eventually happen.
 *
 * That rule rules out most of the obvious candidates in this codebase, and each exclusion is a real one:
 *
 * | Tempting | Why not |
 * | --- | --- |
 * | better-auth sessions | `secondaryStorage` needs atomic `getAndDelete` and `increment`; KV has neither, and backing it would **silently break rate limiting** — a 6-digit OTP is only as strong as its attempt counter. See `BetterAuth.ts`. |
 * | the armed auto-approve rule | disarming must take effect immediately. A 60-second window means paying suppliers under authority somebody just revoked. |
 * | a member's role | `SessionLive` re-checks membership every request deliberately, so that revocation is near-immediate. Caching it reinstates the window it exists to avoid. |
 * | the review queue | plan risk R3, the same reason the transactional Hyperdrive config has caching disabled. |
 *
 * What is left is genuinely immutable-by-key, and `Cache.ts` is where the argument for each one has to be
 * written down.
 *
 * ## Why a port rather than the binding
 *
 * So `modules` stays runnable in Node — the eval harness and every test get an in-memory implementation,
 * and a cache that cannot be exercised without a Cloudflare binding is a cache nobody measures.
 */
import { Context, Effect, Layer } from "effect"

export interface CacheService {
  /** The value, or null when absent. A miss is never an error: the caller reads through. */
  readonly get: (key: string) => Effect.Effect<string | null>
  /**
   * Stores a value. `ttlSeconds` is a floor on how long it may be kept, not a guarantee — KV may evict
   * sooner, and every caller must therefore treat a miss as normal.
   */
  readonly set: (key: string, value: string, ttlSeconds: number) => Effect.Effect<void>
}

export class Cache extends Context.Service<Cache, CacheService>()("shared/Cache") {}

/**
 * Reads through the cache, computing on a miss.
 *
 * **A cache failure is never the caller's problem.** A `get` that throws, a `set` that fails, a KV
 * namespace that is unreachable — all of them fall through to `compute`, because the cache is an
 * optimisation and the value is always derivable. Anything else would make a performance feature into an
 * availability risk, which is the usual way a cache causes an outage.
 */
export const readThrough = <E, R>(options: {
  readonly key: string
  readonly ttlSeconds: number
  readonly compute: Effect.Effect<string, E, R>
}): Effect.Effect<string, E, R | Cache> =>
  Effect.gen(function*() {
    const cache = yield* Cache
    const hit = yield* Effect.orElseSucceed(cache.get(options.key), () => null)
    if (hit !== null) return hit
    const value = yield* options.compute
    // Ignored on purpose: a failed write costs a future miss and nothing else.
    yield* Effect.ignore(cache.set(options.key, value, options.ttlSeconds))
    return value
  })

/**
 * The no-op cache. Every read misses, every write is discarded.
 *
 * The default for tests and for the eval harness, and it has to be **behaviourally transparent**: any test
 * that passes with a real cache must pass with this one, which is only true because a miss is normal and a
 * write is unobservable. If that ever stops holding, something is using the cache as a store.
 */
export const CacheNoop: Layer.Layer<Cache> = Layer.succeed(Cache)({
  get: () => Effect.succeed(null),
  set: () => Effect.void
})
