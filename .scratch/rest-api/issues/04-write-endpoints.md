# The nine write endpoints, and the one that needs care

Status: ready-for-agent
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
