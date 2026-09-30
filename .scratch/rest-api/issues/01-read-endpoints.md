# The read half of the async contract: GET decisions and intakes

Status: done

`POST /api/v1/intakes` answers **202 with two ids and no way to read the outcome**. `docs/PLAN.md` names the
missing endpoint by path — _"the caller polls `GET /api/v1/decisions?intake_id=…`"_ — so this is an unfinished
contract rather than a new idea.

## What exists already

The use cases are written and tested against real Postgres:

- `decision/use-cases/Decision/ListQueue.ts` — clamps a caller-supplied `limit`, returns `QueueItem`s
- the same file's `GetDecision` — returns a `DecisionDetail` with its citations
- `intake/use-cases/Intake/ListIntakes.ts` — same limit clamping

So the work is a transport edge plus wire types, not a feature.

## What it needs before building

- **`ListQueue` has no `intake_id` filter.** The path PLAN names is a filter on a collection, so the use case
  gains an optional predicate. Worth doing there rather than filtering in the edge: the tenant predicate is
  enforced inside `db.scoped`, and a filter applied after the page is cut returns fewer rows than asked for.
- **Frozen wire types for decisions.** `QueueItem` and `DecisionDetail` are domain types, and ADR-0006's rule
  is that no domain type is re-exported on the wire however convenient. So `DecisionSummaryV1` and
  `DecisionDetailV1`, snake_case, hand-mapped at the edge — the shape `IntakeWire.ts` already models.
  **The citations are the interesting part**: a decision's value is that every claim carries a verbatim
  excerpt somebody can audit a year later, so `source_span` and `page` are part of the v1 contract and
  cannot be added later without a client having shipped without them.
- **`404` as a typed error**, not a bare framework response, matching how `UnsupportedDocumentV1` is a
  contract rather than a default.
- **Issue `03` first, or in the same pass**: a collection endpoint without a defined paging shape is the thing
  that gets frozen wrong.

## Not this issue

`GET /api/v1/decisions/{id}/approve` or any state change. Approval is a CAS against a decision row with an
`approved_by`, and the one execution path is load-bearing (`grep -c` asserts a single emit call site); adding
a second door to it belongs in its own issue with its own tenancy test.

## Comments

Scope confirmed as **stage B** of full parity: the eight read endpoints, not decisions alone —
`GET /decisions`, `/decisions/{id}`, `/intakes`, `/rooms`, `/rooms/{id}/messages`, plus the three that exist.
Blocked on 03, because a collection endpoint freezes its paging shape the moment it ships.

Done. Eight operations, and the async contract is whole: `POST /intakes` answers 202 with an `intake_id`, and
`GET /decisions?intake_id=` is what that id is for.

```
GET  /api/v1/health                         200
GET  /api/v1/me                             200 401
GET  /api/v1/intakes                        200 400 401
POST /api/v1/intakes                        202 401 415
GET  /api/v1/decisions                      200 400 401
GET  /api/v1/decisions/{decisionId}         200 401 404
GET  /api/v1/rooms                          200 400 401
GET  /api/v1/rooms/{roomId}/messages        200 400 401 404
```

**The wire types cost one line each**, because `wireFrom` derives the snake_case names and the projection drops
everything unlisted at encode time — so a handler returns the use case's own values and the response is the
published subset. `DecisionDetailV1` and `MessageV1` use `wire` with a spread instead, because a nested domain
type carries camelCase keys of its own and has to be substituted.

Three things worth knowing for stage C:

- **`HttpApiEndpoint` names path parameters `params`, not `path`.** An unknown key makes TypeScript fall back to
  the no-content overload, so the error blames `success` and says nothing about the real problem.
- **An undeclared error becomes a type mismatch, not a 500.** Both `list` endpoints needed
  `error: HttpApiError.BadRequest` the moment cursor decoding could fail, and the handler stopped compiling
  until they had it — which is the check working.
- **A 400 for an unreadable cursor, never page one.** Silently restarting is how a client reads the first page
  forever. Asserted at runtime, including a cursor with the wrong number of components, which would otherwise
  compare a room name against a timestamp.

`subject_id` is deliberately not published on a channel: it is null for every one of them, and a field that is
always null is a question a client should not have to ask.

Verified: 356 tests in 37 files, 53 of them in the real Worker — including that another organization's arrivals
are absent, that both typed 404s say nothing about why, and that the OpenAPI document describes every path it
serves.
