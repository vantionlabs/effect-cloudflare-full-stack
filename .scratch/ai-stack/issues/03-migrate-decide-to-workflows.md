# Migrate the decide pipeline to Cloudflare Workflows, and delete `WorkflowEnginePg`

Status: ready-for-agent — **first half landed 2026-09-30**

ADR-0024. The trigger on ADR-0003 fired, and the memo property is proven by execution
(`apps/worker/test/WorkflowStepMemo.test.ts`: step `one` ran once while step `two` ran twice).

## What landed 2026-09-30

The pipeline is decoupled and the orchestration is proven, but **the queue has not been flipped** and
`WorkflowEnginePg` is still alive. What exists:

- `DecideContract.ts` + `DecideSteps.ts` — the steps as independently runnable Effects, so **two
  orchestrators drive one set of steps**: the `effect/workflow` composition that tests and `evals/` run in
  Node, and the Cloudflare entrypoint production will run. That split is not optional — a pipeline
  reachable only through a `WorkflowEntrypoint` would take the only measurement of decision quality with it.
- `apps/worker/src/DecideWorkflow.ts` — the entrypoint, as a factory annotated with a constructor interface
  (`TS4094`: an exported anonymous class cannot inherit protected members). A factory rather than a plain
  class because a `WorkflowEntrypoint` is instantiated by the runtime and cannot be handed the composed
  runtime, and importing `Main.ts` would be a cycle with the export it needs.
- Four steps: `Extract`, `Retrieve`, `Decide`, `Settle`. Binding `DECIDE` in every environment, and
  `bindings:check` now knows the `workflows` key — **the second time that list has been the hole it exists
  to close**, verified to bite.
- The decision insert is now a **claim** (`on conflict … do nothing returning id`), which a retryable step
  requires and which also closes a TOCTOU that exists today: the existence read and the insert are not one
  transaction, so two concurrent redeliveries both insert and one self-heals only because the queue retries.
- 4 tests in real `workerd` against the real orchestration: the three expensive steps run once while the
  settle step retries, and the short circuit returns without running a single step (its `extract` throws, so
  removing the early return fails loudly rather than quietly costing a model call per redelivery).

**Two things in ADR-0024 were wrong and are corrected in place there**: where the connection opens, and what
retries. An error outside a `step.do` fails the instance with NO retry, and a step retry does not re-enter
`run()` — measured, and it moved the rails-and-write half inside a step.

## What blocks the flip

`documentText` is in the Workflow params, and params are persisted while a step's non-stream return is
capped at 1 MiB — a scanned document's text can approach that. **Parsing has to become the first step**, so
the workflow takes `{ orgId, documentId, vertical }` and reads the blob itself. That also memoises the parse,
which is the second most expensive thing in the pipeline.

Then the queue becomes: resolve the tenant, create an instance, ack. Which moves two things that are
currently `ConsumeEvent`'s:

- **The `events` row lifecycle.** The row must not go `done` when the instance is merely started, or the
  audit trail stops describing the work. The workflow should own the transition, and recording the instance
  id on the row is what makes a running decision queryable — which is the product's own thesis applied to
  its machinery.
- **The terminal-versus-retryable classification.** `Terminal.ts`'s union is a typed error channel today and
  a step boundary is a `Promise`, so a terminal failure must become a non-retrying step outcome rather than
  burning five attempts on something that fails identically every time.

Only then does `WorkflowEnginePg` come out, closing risk R7.

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
