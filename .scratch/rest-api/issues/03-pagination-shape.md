# One paging shape for every collection, decided before the first one is frozen

Status: done

`ListQueue` and `ListIntakes` both clamp a caller-supplied `limit` against a hard ceiling — the right
instinct, and already tested — but **neither returns a cursor**, so there is no way to ask for the next page.
No REST collection endpoint exists yet, which is exactly why this is worth deciding now: the first one freezes
the shape for `/api/v1`, and paging is not something a v1 client can be asked to change.

## The decision, and why the default answer is probably right

**Keyed (cursor) paging on `id`, not offset.** Ids are UUIDv7 — time-ordered by construction — so
`where id < $cursor order by id desc limit $n` is a single index range scan, it does not drift when rows are
inserted mid-page (a review queue is written to constantly, and offset paging shows the same decision twice or
skips one), and it needs no count. `order by id` is already chronological without a second column, which is
recorded as load-bearing in `Ids.ts`.

What that implies for the contract: a `next_cursor` in the response body rather than a `Link` header. The body
is where the frozen wire schema lives and where a client that does not read headers still sees it; `Link` is
more conventional and less likely to survive a hand-written PHP client.

## What it needs before building

- Whether `next_cursor` is `null` or absent at the end of a collection. Absent is smaller; null is easier for a
  generated client to hold a type for, and the wire schemas elsewhere already prefer an explicit null
  (`HealthV1.database`, and there is a test asserting the key is present even when null).
- Whether a total count is ever returned. It is a second query against a tenant-filtered table and almost
  nothing needs it; saying no once is cheaper than saying it per endpoint.
- The ceiling, named in one place. Two use cases currently define their own `MAX_LIMIT`.

## Comments

**Stage A, and it goes first.** Decision taken as this issue recommended: keyed paging on `id` (UUIDv7, so
`order by id desc` is chronological and a page does not drift as rows are inserted), `next_cursor` in the
response **body** rather than a `Link` header, and one `MAX_LIMIT` named in one place instead of per use case.
