/**
 * The decisions every transport edge in v1 makes, in one place.
 *
 * Each handler in this package was repeating the same two or three wrappers — `Effect.orDie`,
 * `withDatabase`, and latterly `withTenant` — six times across four files. The repetition was not the
 * problem; **the repetition being editable in one place and not another was.** Any of those three is a
 * policy decision about how the API behaves at its boundary, and a policy that is restated at every call
 * site drifts one call site at a time.
 *
 * So the wrappers are named for the decision they encode rather than for the function they call, and there
 * are exactly two of them. A third would mean a third kind of handler, which is worth noticing.
 */
import { Connect, withDatabase } from "@ea/database/Database"
import { CurrentOrg, CurrentOrgFromUser, CurrentUser } from "@ea/domain/Identity"
import { Effect, Layer, Stream } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

/**
 * Supplies the tenant from the authenticated session.
 *
 * Shared use cases require `CurrentOrg` rather than `CurrentUser`, because the weaker requirement is what
 * keeps them reachable from the queue consumer, which has no user at all — that asymmetry is what lets the
 * decide pipeline run in both places (docs/services.md §3.1).
 *
 * **Per handler rather than in the `Authenticated` middleware, and not by choice**: a middleware declares a
 * single `provides` tag, and a union collapses to `any` there. Per handler turns out to be the better
 * failure anyway — `rg serveForTenant` lists every interactive caller of a tenant-scoped use case, which is
 * the list a tenancy audit wants, and a handler that forgot it does not compile.
 */
const withTenant = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, CurrentOrg> | CurrentUser> =>
  Effect.provideServiceEffect(effect, CurrentOrg, Effect.map(CurrentUser, (identity) => identity.orgId))

/**
 * Runs a use case at the transport edge: one connection, and a database failure is a defect.
 *
 * Two decisions, and both are about what a caller can act on.
 *
 * **`withDatabase` here, not in the use case.** Connection lifetime is a per-request concern — a socket
 * cannot outlive the invocation that opened it on Workers — and keeping it out of the use case is what lets
 * the same code run under the eval harness's own connection, or a test's.
 *
 * **`SqlError` becomes a defect.** A database failure is not in the v1 contract, and a client we do not control
 * cannot do anything differently on learning about it: the remedy for "the database was unreachable" is to
 * retry, which is what a 500 already tells them. Surfacing it as a typed wire error would freeze an
 * implementation detail into a public schema we have promised not to break. It becomes a defect, so it is
 * logged with its cause and answered with a 500 rather than leaked.
 *
 * What this deliberately does NOT swallow is the use case's own domain errors. Those stay in the channel
 * and are mapped to wire errors by the handler, because a caller *can* act on `UnsupportedDocument`.
 */
export const serve = <A, E, R>(
  effect: Effect.Effect<A, E, R | SqlClient.SqlClient>
): Effect.Effect<A, Exclude<E, SqlError.SqlError>, Exclude<R, SqlClient.SqlClient> | Connect> =>
  // `Exclude<R, SqlClient>` mirrors `withDatabase`, which supplies the connection and therefore removes it
  // from the requirements. Written as `Exclude<R, never>` first, which is a no-op — so `SqlClient` escaped
  // into the app layer's context and `Main.ts` stopped compiling. A signature that lies about what it
  // provides is worse than no helper.
  /*
   * `catchTag("SqlError")`, NOT `orDie`.
   *
   * `orDie` discards the ENTIRE error channel, so the use case's own domain errors die with it. Written
   * that way first, and the intake tests caught it immediately: a `.pdf` upload answered 500 instead of the
   * typed 415 that names the supported types — the product's refusal turned into a crash. The docstring
   * above already said this must not happen, which is the useful part: the comment was right and the code
   * disagreed with it.
   */
  Effect.catchTag(withDatabase(effect), "SqlError", Effect.die) as Effect.Effect<
    A,
    Exclude<E, SqlError.SqlError>,
    Exclude<R, SqlClient.SqlClient> | Connect
  >

/**
 * As `serve`, and additionally supplies the tenant.
 *
 * The one to reach for by default: most use cases need to know which organization and not which person. Use
 * `serve` only when the use case genuinely requires `CurrentUser` — recording `approved_by`, or anything
 * whose answer differs between two members of the same organization.
 */
export const serveForTenant = <A, E, R>(
  effect: Effect.Effect<A, E, R | SqlClient.SqlClient>
): Effect.Effect<
  A,
  Exclude<E, SqlError.SqlError>,
  Exclude<R, CurrentOrg | SqlClient.SqlClient> | CurrentUser | Connect
> =>
  Effect.catchTag(withTenant(withDatabase(effect)), "SqlError", Effect.die) as Effect.Effect<
    A,
    Exclude<E, SqlError.SqlError>,
    Exclude<R, CurrentOrg | SqlClient.SqlClient> | CurrentUser | Connect
  >

/**
 * As `serveForTenant`, for a **stream**: the connection and the tenant live as long as the stream does.
 *
 * `withDatabase` cannot be reused here. It opens a connection inside one effect and releases it when that
 * effect finishes — which for a stream is when the stream has been *constructed*, not when it has been read.
 * The pulls that follow would then run against a closed connection, and the symptom is a stream that works in a
 * test that collects it eagerly and fails wherever it is consumed lazily.
 *
 * So the connection is a scoped LAYER instead, because a layer's scope is the stream's scope. Same for the
 * tenant: `CurrentOrgFromUser` derives it from the authenticated session, so a stream cannot outlive the
 * identity that started it.
 */
export const serveStreamForTenant = <A, E, R>(
  stream: Stream.Stream<A, E, R | SqlClient.SqlClient | CurrentOrg>
): Stream.Stream<
  A,
  Exclude<E, SqlError.SqlError>,
  Exclude<R, CurrentOrg | SqlClient.SqlClient> | CurrentUser | Connect
> =>
  stream.pipe(
    Stream.provide(
      Layer.mergeAll(
        Layer.effect(SqlClient.SqlClient)(Effect.flatMap(Connect, (connect) => connect.open)),
        CurrentOrgFromUser
      )
    ),
    // Same reasoning as `serve`: a database failure is not in the contract and a caller cannot act on it.
    Stream.catchTag("SqlError", (error) => Stream.die(error))
  ) as Stream.Stream<
    A,
    Exclude<E, SqlError.SqlError>,
    Exclude<R, CurrentOrg | SqlClient.SqlClient> | CurrentUser | Connect
  >
