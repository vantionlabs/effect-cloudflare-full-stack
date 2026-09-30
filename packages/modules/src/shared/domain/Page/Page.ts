/**
 * One paging shape for every collection, decided before the first REST collection froze it.
 *
 * **Keyed, not offset.** Ids are UUIDv7 — time-ordered by construction — so a keyset predicate is a single
 * index range scan, needs no count, and **does not drift**. That last property is the reason: a review queue
 * is written to constantly, and offset paging on a table that grows at the head shows the same decision twice
 * or skips one entirely. Neither is acceptable in a list somebody works through.
 *
 * **The cursor is OPAQUE.** It is the last row's sort key, percent-encoded and joined — which is readable, and
 * must not be read: which columns a collection sorts by is an implementation detail that will change, and a
 * client that parses this will break when it does. `next_cursor` goes back unmodified or not at all.
 *
 * **Why the keys are strings.** A keyset can be compound (`(received_at, id)`, `(name, id)`), and the parts
 * have different types. Rendering every part as a string keeps one cursor format for every collection; each
 * use case casts its own parts back in SQL, where the column types are known anyway.
 *
 * **There is no total count**, deliberately. It is a second query against a tenant-filtered table, almost
 * nothing needs it, and saying no once here is cheaper than saying it per endpoint.
 */
import { Result, Schema } from "effect"

/**
 * The ceiling on a page, in one place rather than per use case.
 *
 * A client-supplied limit is a request, not an instruction: an unbounded page is a way to ask one Worker
 * invocation to encode an organization's whole history inside a CPU budget.
 */
export const MAX_PAGE_SIZE = 200
export const DEFAULT_PAGE_SIZE = 50

/** Clamps whatever the caller asked for into `[1, MAX_PAGE_SIZE]`, defaulting when absent. */
export const clampPageSize = (requested?: number | undefined): number =>
  Math.min(Math.max(Math.trunc(requested ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE)

/**
 * A cursor that cannot be decoded.
 *
 * Its own failure rather than an empty first page, because silently restarting a pagination loop is how a
 * client ends up reading page one forever. The payload names nothing: a cursor is not a credential, but it is
 * also not worth echoing back a caller's malformed input.
 */
export class InvalidCursor extends Schema.TaggedError<InvalidCursor>()("InvalidCursor", {}) {}

/**
 * `,` as the separator, because `encodeURIComponent` escapes it to `%2C`.
 *
 * So a key containing the separator is impossible rather than merely unlikely — which matters, since one of
 * these keys is a room name that a user chose.
 *
 * **This was `~` first, and the test caught it.** `encodeURIComponent` leaves nine characters alone —
 * `- _ . ! ~ * ' ( )` — so a room name containing `~` produced a three-part key from a two-part cursor and
 * would have paged from the wrong row. The rule is to pick a separator from OUTSIDE that set, not one that
 * merely looks unusual.
 */
const SEPARATOR = ","

/** The cursor for a page whose last row had these sort-key values, in the order the query sorts by. */
export const encodeCursor = (keys: ReadonlyArray<string>): string =>
  keys.map((key) => encodeURIComponent(key)).join(SEPARATOR)

/** Reads a cursor back, or fails. `decodeURIComponent` throws on a malformed escape, which is the common case. */
export const decodeCursor = (cursor: string): Result.Result<ReadonlyArray<string>, InvalidCursor> => {
  if (cursor === "") return Result.fail(new InvalidCursor())
  try {
    return Result.succeed(cursor.split(SEPARATOR).map((part) => decodeURIComponent(part)))
  } catch {
    return Result.fail(new InvalidCursor())
  }
}

/**
 * The cursor for the next page, or `null` when this page was not full.
 *
 * **A full page always yields a cursor, even when it was the last one.** The alternative is asking for one row
 * more than requested on every query to find out — a cost paid on every page to save one empty page at the
 * end. So a client may make one final request that returns nothing, and that is the documented contract
 * rather than a bug.
 */
export const nextCursor = <A>(
  items: ReadonlyArray<A>,
  limit: number,
  keysOf: (item: A) => ReadonlyArray<string>
): string | null => {
  if (items.length < limit) return null
  const last = items[items.length - 1]
  return last === undefined ? null : encodeCursor(keysOf(last))
}
