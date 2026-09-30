/**
 * The two things every paged endpoint does, so no handler writes them twice.
 *
 * A cursor arrives as an opaque string and has to become the keyset a use case filters on; a page of results has
 * to become a body carrying the cursor for the next one. Both are transport concerns — the use case takes a
 * keyset and returns rows, and knows nothing about strings a client held onto.
 */
import { decodeCursor, nextCursor } from "@ea/modules/shared/domain/Page"
import { Effect, Result } from "effect"
import { HttpApiError } from "effect/http-api"

/**
 * A cursor read back into its parts, or a 400.
 *
 * **400 and not an empty first page.** A cursor this server did not issue means the client's pagination state is
 * wrong, and silently restarting from the beginning is how a loop reads page one forever. `HttpApiError.BadRequest`
 * rather than a typed wire error because there is nothing product-specific to say — contrast
 * `UnsupportedDocumentV1`, which names what IS supported and is therefore worth freezing.
 *
 * The arity is checked, so a cursor from a DIFFERENT collection is refused rather than silently producing a
 * keyset with a missing component — which would compare a room name against a timestamp.
 */
const keyset = (
  cursor: string | undefined,
  arity: number
): Effect.Effect<ReadonlyArray<string> | undefined, HttpApiError.BadRequest> => {
  if (cursor === undefined) return Effect.succeed(undefined)
  const decoded = decodeCursor(cursor)
  if (!Result.isSuccess(decoded) || decoded.success.length !== arity) {
    return Effect.fail(new HttpApiError.BadRequest())
  }
  return Effect.succeed(decoded.success)
}

/** A single-component keyset, for a collection sorted by id alone. */
export const keyset1 = (
  cursor: string | undefined
): Effect.Effect<readonly [string] | undefined, HttpApiError.BadRequest> =>
  Effect.map(keyset(cursor, 1), (keys) => keys === undefined ? undefined : [keys[0]!] as const)

/** A two-component keyset, for a collection sorted by a column and then by id. */
export const keyset2 = (
  cursor: string | undefined
): Effect.Effect<readonly [string, string] | undefined, HttpApiError.BadRequest> =>
  Effect.map(keyset(cursor, 2), (keys) => keys === undefined ? undefined : [keys[0]!, keys[1]!] as const)

/**
 * A page body: the rows, and the cursor for the next page.
 *
 * `items` are the use case's own values, unmapped. The wire schema publishes a projection of them and drops the
 * rest at encode time, so a handler does not pick fields by hand — which is what makes the projection a rule
 * rather than a habit (see `shared/domain/Wire`).
 */
export const page = <A>(
  items: ReadonlyArray<A>,
  limit: number,
  keysOf: (item: A) => ReadonlyArray<string>
): { readonly items: ReadonlyArray<A>; readonly next_cursor: string | null } => ({
  items,
  next_cursor: nextCursor(items, limit, keysOf)
})
