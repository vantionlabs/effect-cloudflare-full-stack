/**
 * How a frozen wire type is made, so that making one is a line rather than a file.
 *
 * **The problem this solves.** ADR-0012 requires every public response to be a versioned, snake_case shape that
 * is not a domain type — so a domain rename cannot break a client we do not control. Written by hand that is,
 * per type, a class restating every field and a mapping function restating every field again. For the sixteen
 * operations this API exposes it is several hundred lines whose only content is `decisionId` becoming
 * `decision_id`, and nothing checks that the two halves agree.
 *
 * **What replaces it.** `wireFrom(DomainType, ["a", "bCamel"])` does two things and no more:
 *
 * 1. **Projects.** The listed keys are the public surface; everything else in the domain type is not published.
 *    That list is the valuable part and stays explicit — it is the decision about what a client may see.
 * 2. **Renames, derived.** `Schema.encodeKeys` renames keys in the ENCODED form only, so the decoded side stays
 *    the domain's own types and shapes. A handler returns a domain value and the response is snake_case with no
 *    mapping function in between, because encoding *is* the mapping.
 *
 * **What this gives up, and what pays for it.** Hand-writing made a domain rename impossible to propagate;
 * deriving makes it possible. The compensating control is `test/OpenApiSnapshot.test.ts`, which holds the
 * generated document as a committed fixture — so a domain rename now fails a test that names the field and
 * prints the diff, instead of silently shipping. That is a different guarantee, and on balance a stronger one:
 * the hand-written version could also be wrong, and nothing compared it to anything.
 */
import { Schema } from "effect"

/**
 * `camelCase` → `snake_case`, at the type level, so the encoded keys are known statically.
 *
 * Needed as a type and not only as a function because the OpenAPI document is generated from the schema's
 * static shape: a runtime-only rename would produce a document whose property names are `string`.
 *
 * **It inserts an underscore before every capital**, which is right for `decisionId` and wrong for an acronym
 * run — `parsedHTML` would become `parsed_h_t_m_l`. Not handled, deliberately: the fix is to not name a field
 * that way, and a test asserts the behaviour so the limitation is visible rather than surprising.
 */
type SnakeCase<S extends string> = S extends `${infer Head}${infer Tail}`
  ? Head extends Uppercase<Head>
    ? Head extends Lowercase<Head> ? `${Head}${SnakeCase<Tail>}` : `_${Lowercase<Head>}${SnakeCase<Tail>}`
  : `${Head}${SnakeCase<Tail>}`
  : S

const toSnakeCase = (key: string): string => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

/**
 * A wire schema: the named fields of `source`, with snake_case on the outside.
 *
 * `source` is anything carrying `fields` — a `Schema.Class` or a `Schema.Struct` — so a domain class can be
 * projected without being re-declared, and the field types come from one place.
 */
export const wireFrom = <
  F extends Schema.Struct.Fields,
  const K extends ReadonlyArray<keyof F & string>
>(
  source: { readonly fields: F },
  keys: K
) => {
  const fields = {} as { [P in K[number]]: F[P] }
  const mapping = {} as { [P in K[number]]: SnakeCase<P> }
  for (const key of keys) {
    // eslint-disable-next-line
    ;(fields as Record<string, unknown>)[key] = source.fields[key]
    ;(mapping as Record<string, unknown>)[key] = toSnakeCase(key)
  }
  return Schema.Struct(fields).pipe(Schema.encodeKeys(mapping))
}

/**
 * A page of a collection: the items, and the cursor for the next page or `null`.
 *
 * One shape for every collection, so a client writes its pagination loop once. `next_cursor` is in the body
 * rather than a `Link` header because the body is where the frozen schema lives, and a hand-written PHP client
 * is far likelier to read a field than a header.
 */
export const pageOf = <S extends Schema.Top>(item: S) =>
  Schema.Struct({
    items: Schema.Array(item),
    /**
     * Opaque. It is the last row's sort key, and which columns a collection sorts by will change — a client
     * that parses this will break when it does. Send it back unmodified or not at all.
     *
     * Null means this page was not full, so there is nothing after it. A FULL last page still returns a
     * cursor, so one final request may return an empty `items` — that is the contract, not a bug.
     */
    next_cursor: Schema.NullOr(Schema.String)
  })
