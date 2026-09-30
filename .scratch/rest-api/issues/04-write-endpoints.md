# The nine write endpoints, and the one that needs care

Status: done
Blocked by: 01

Stage C of full parity. Eight of the nine are mechanical; one is not.

| Method | Path                                           | Routes to                    |
| ------ | ---------------------------------------------- | ---------------------------- |
| POST   | `/api/v1/rooms`                                | `CreateRoom`                 |
| POST   | `/api/v1/rooms/{id}/messages`                  | `PostMessage`                |
| PATCH  | `/api/v1/messages/{id}`                        | `EditMessage`                |
| DELETE | `/api/v1/messages/{id}`                        | `DeleteMessage`              |
| PUT    | `/api/v1/messages/{id}/reactions/{emoji}`      | `ToggleReaction`             |
| PUT    | `/api/v1/rooms/{id}/read`                      | `MarkRead`                   |
| POST   | `/api/v1/rooms/{id}/archive`                   | `ArchiveRoom`                |
| POST   | `/api/v1/ask`                                  | `AskCorpus`                  |
| POST   | `/api/v1/decisions/{id}/approve` and `/reject` | `ApproveDecision` — **care** |

## The one that needs care

`ApproveDecision` is a compare-and-swap that emits `decision.execute`, and **the single emit call site is
asserted by a `grep -c` test** — it is the mechanical half of the claim that an approved decision and an
auto-approved one take the same path. A REST edge must call the same use case, not reimplement the CAS, and
the existing test is what stops the second door becoming a second path.

Two consequences for this issue:

- The edge maps the CAS's "somebody else already decided this" into a typed **409 Conflict**, not a 500 and not
  a silent success. Two tabs approving already produce one event; two clients must produce the same.
- It interacts with `02`: whether an API key may approve at all is an authorisation question, and the answer
  affects this endpoint's existence rather than its shape.

## Method choices worth stating

`PUT` for a reaction and for a read receipt because both are **idempotent set-membership**, not appends — the
same call twice must leave the same state, which `ToggleReaction`'s name works against and its behaviour has
to reconcile. `POST /archive` rather than `DELETE /rooms/{id}` because archiving is not deletion and the
distinction is deliberate in the domain.

## Comments

Done, and the surface is **19 operations** — one more than the sixteen RPC methods, because a toggle became two
idempotent endpoints.

**The reaction is the interesting one.** `ToggleReaction` is a toggle because to a user it is one button, and a
toggle is unsafe over HTTP: a client that retries after a lost response takes its own reaction back. So the use
case grew an optional `desired` parameter, `PUT` means present, `DELETE` means absent, and both are asserted
idempotent at runtime. RPC still toggles.

**The compiler and a runtime test each caught a real mistake:**

- `settle` answered **409 for a decision that does not exist**, because the compare-and-swap reports
  nothing-updated identically for "no such row" and "already settled" — so a client was told a decision was
  there and merely closed. Existence is read first now, tenant-scoped, and the race is harmless because losing
  it gives 409, which is correct.
- `serve` instead of `serveForTenant` on approve left `CurrentOrg` in the per-request door, and `Main.ts` stopped
  compiling. My comment claiming `serve` was right was wrong.

**And one genuine product bug fell out of it**, tracked as `05`: `resolveIdentity` CAST better-auth's role
instead of decoding it, and better-auth's default role is `member`, which is not in our closed set — so a member
added through its own invitation flow got a **500 with an empty body** on every request. It decodes now and an
unknown role is a 401.

Method and status choices, each argued in the file rather than assumed: `POST` to an action sub-resource for
approve and reject, because approving is a compare-and-swap that emits an event rather than a field assignment;
`PUT /rooms/{id}/archived` rather than `POST /archive` or `DELETE /rooms/{id}`, because archiving is reversible
and a channel is never deleted; `PATCH` for an edit; `DELETE` for a message that keeps its row, because to a
caller it is gone and `deleted_at` is what a reader branches on; **201** on both creates, annotated per endpoint
because `RoomV1` is also a 200 body elsewhere; **403** on a non-author edit, distinguishable from 404 safely
because the caller can already read the message.

`HttpApiEndpoint` pre-makes only `get`, `post`, `put` and `patch`, so `DELETE` comes from `make("DELETE")` — the
same constructor the four are built from. And `Layer.mergeAll` in `Main.ts` had to group the edges by transport,
because the full surface pushed `pipe` past its twenty-argument limit.
