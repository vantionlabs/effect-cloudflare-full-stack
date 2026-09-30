/**
 * Turn `@handles` in a body into the people they name.
 *
 * **Matched on the email's local part, case-insensitively.** That is a deliberate simplification with a known
 * cost: it works because an organization's members have distinct addresses, and it breaks for `alice@a.com` and
 * `alice@b.com` in the same tenant, where it would match both. The real answer is what Discord does — a picker
 * that inserts an opaque id, so the text carries the identity rather than a guess at it — and that is a UI feature
 * with a wire format, not a parsing improvement. Recorded here so the next person does not mistake this for the
 * finished design.
 *
 * Unmatched handles are simply not mentions. A typo should read as text, not fail a message.
 */
import { Db, textArray } from "@ea/database/Database"
import { CurrentUser } from "@ea/domain/Identity"
import { Effect } from "effect"

/**
 * `@` followed by the characters an email local part can contain.
 *
 * Deliberately does not match an `@` inside a word, so an address written out in full — "mail alice@example.com" —
 * does not mention the person twice or name a domain. The leading boundary is what does that.
 */
const HANDLE_PATTERN = /(?:^|[^\w@])@([a-zA-Z0-9._%+-]+)/g

export const parseHandles = (body: string): ReadonlyArray<string> => {
  const handles = new Set<string>()
  for (const match of body.matchAll(HANDLE_PATTERN)) {
    const handle = match[1]
    if (handle !== undefined && handle !== "") handles.add(handle.toLowerCase())
  }
  return [...handles]
}

/**
 * The organization's members whose address matches one of the handles.
 *
 * Reads better-auth's `member` and `user` tables, as `ListMessages` does for the author's email — our tables carry
 * no foreign key into them, so this is a read-only join across the two schemas.
 *
 * Scoped by `member."organizationId"` rather than by `Db.scoped`'s predicate, because better-auth's tables do not
 * have our `organization_id` column. The tenant still comes from the session, which is the part that matters.
 */
export const ResolveMentions = (body: string) =>
  Effect.gen(function*() {
    const handles = parseHandles(body)
    if (handles.length === 0) return []

    const db = yield* Db
    const identity = yield* CurrentUser

    return yield* db.scoped((sql, orgId) =>
      sql<{ id: string; email: string }>`
        select u.id, u.email
          from member mb
          join "user" u on u.id = mb."userId"
         where mb."organizationId" = ${orgId}
           -- textArray, not a bare parameter: the driver infers the element type from the first element, so an
           -- empty array of text fails to encode — the happy path breaking while the unhappy one works (a trap
           -- recorded in AGENTS.md). The early return above also guards it; the helper is what makes it correct
           -- rather than lucky.
           and lower(split_part(u.email, '@', 1)) = any(${textArray(sql, handles)})
           /*
            * You cannot mention yourself. It is never a notification anybody wants, and leaving it in would make
            * every "@me note to self" light up its author's own badge.
            */
           and u.id <> ${identity.userId}
      `
    )
  })
