# The read half of the async contract: GET decisions and intakes

Status: needs-triage

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
