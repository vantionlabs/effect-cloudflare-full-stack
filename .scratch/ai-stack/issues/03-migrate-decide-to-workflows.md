# Migrate the decide pipeline to Cloudflare Workflows, and delete `WorkflowEnginePg`

Status: ready-for-agent

ADR-0024. The trigger on ADR-0003 fired, and the memo property is proven by execution
(`apps/worker/test/WorkflowStepMemo.test.ts`: step `one` ran once while step `two` ran twice).

## Order, and it matters

1. **A `DecideDocumentWorkflow` as a `WorkflowEntrypoint`**, with the four existing activities as
   `step.do("Extract"|"Retrieve"|"Decide"|"Judge", …)`. Names are the cache key, so they are fixed and
   deterministic.
2. **The connection opens in `run()`, outside every step** — the Rules of Workflows forbid a
   non-serializable resource crossing a step boundary, and a `SqlClient` is one.
3. **Each step runs an `Effect` on the memoised runtime**, so `Db.scoped` still requires `CurrentOrg` and
   the tenancy seam survives inside a step. This is the part that must not regress.
4. **Terminal-versus-retryable classification moves to the step boundary.** A step boundary is a `Promise`,
   so `shared/domain/Errors/Terminal.ts`'s union stops being carried in a typed channel. Catch at the
   boundary, and **keep the classification observable** — a `RailsRefused` that silently becomes a retry
   burns model calls on a deterministic outcome, which is the exact failure docket recorded.
5. **Only then delete `WorkflowEnginePg`** and the two workflow tables, closing risk R7.

## Constraints to honour

- Every step sets retries explicitly. Default retry behaviour is undocumented.
- A step return persists up to 1 MiB; a large retrieval goes to R2 by reference.
- Step timeout ≤ 30 minutes. A human pause is `waitForEvent`, never a sleep.
- Do not split finer than the four activities. Steps are metered (3,000/day free, then $0.80/100k), and
  granularity is now a cost as well as a design choice.

## What this unlocks, which is the actual reason

`waitForEvent` up to a year. Approval chains that wait on a person, a webhook or a 48-hour escalation —
which the current engine cannot express at all, because suspend is deliberately stubbed. The human boundary
stays a database row for audit (docket §6 still holds); the _waiting_ stops being a cron's job.
