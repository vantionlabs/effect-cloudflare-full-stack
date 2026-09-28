# ADR-0003 — A Postgres-backed `WorkflowEngine`, not a Durable Object, and not Cloudflare Workflows

**Status:** accepted · **Date:** 2026-09-28 (written late, during step 7, when the question was asked)

## Context

The decide pipeline is `Extract → Retrieve → Decide → Judge`. Extraction costs a model call of roughly
€0.05; the judge is the step most likely to fail transiently. Without memoisation, a transient judge
failure makes Queues redeliver the message and re-run **everything**, including the extraction.

So the requirement is narrow and worth being precise about: **memoise completed steps across
invocations.** It is not "durable suspend". Three candidate homes were considered.

## Decision

**A ~200-line Postgres-backed `WorkflowEngine`, implementing `effect/workflow`'s 10-method interface,
running inside the ordinary Worker invocation.** No separate process, no actor, no new platform
primitive. It lives at `modules/decision/server/Workflow/`, with its two tables in
`modules/decision/tables/Workflow/`.

### Why not `effect/cluster`

Measured rather than assumed:

- **There is no Durable Object runner.** The runners that ship are `HttpRunner`, `SocketRunner`,
  `SingleRunner` and `TestRunner` — all Node-shaped. `SingleRunner` does not skip sharding; it only
  drops runner-to-runner RPC and health checks.
- `SqlMessageStorage` calls `sql.withTransaction` in nine places, six of them read-then-write.
- Sharding runs 3 s / 10 s / 35 s / 60 s background loops that assume long-lived processes.

Cluster's design centre is _N long-lived processes over a shared transactional database_. A Worker is
neither long-lived nor N. Bridging it is 2–4 weeks of framework infrastructure.

`effect/workflow`, by contrast, needs **only** `WorkflowEngine` — verified: nothing under `workflow/`
imports `cluster` (the two matches are comments). `ClusterWorkflowEngine` is one implementation of an
interface, and the framework exports `WorkflowEngine.makeUnsafe` for writing another.

### Why not a Durable Object

A DO would be the obvious reach, and it is wrong here for a reason specific to this product:

- **The memo is part of the audit trail.** `workflow_activities` stores each step's result, which for
  the extraction step means the extracted invoice fields. That has to be queryable in SQL beside the
  decision it produced, and RLS-scoped like everything else — a DO's storage is private to the object
  and invisible to a join. Putting the audit trail somewhere it cannot be queried inverts the product's
  own thesis.
- **Nothing self-schedules.** Waking a suspended execution needs a live runner running a poll loop. A
  DO alarm could provide that, which is exactly why a DO looks attractive — and it is only needed if we
  suspend, which we do not (below).
- A DO _does_ earn its keep elsewhere in this design: per-API-key rate limiting, where single-threaded
  exactness is the whole point.

### Why not Cloudflare Workflows

Cloudflare Workflows exists, it is GA, and **it is better than our engine at the thing we deliberately
do not do.** `step.do()` memoises, `waitForEvent` spans 1 s to 365 days with buffered events, and
retention is built in. If durable suspend becomes a requirement, this is the answer and our engine
should be deleted rather than extended.

It is not the pick now for two reasons:

1. **It inverts the composition.** A Workflow body must be a `WorkflowEntrypoint` class whose
   `run(event, step)` is an async method. Effect would then run _inside_ steps rather than _being_ the
   workflow — so `Activity`, the typed error channel and the layer graph all stop at the step boundary.
   The goal was to express the pipeline in Effect; this expresses it in Cloudflare with Effect inside.
2. **We do not want suspend.** docket's spec §6 settled this before Workers was the target: _"do not
   suspend. Split at the human boundary and let the event row be the checkpoint."_ A pending decision
   is then a database row anyone can query rather than a suspended coroutine somebody has to trust —
   and it survives deploys with no special handling. A `DurableDeferred` token is also unsigned
   base64url of `[workflowName, executionId, deferredName]`, i.e. a forgeable capability to authorise a
   payment.

## Consequences

**Our engine cannot suspend, and must say so loudly rather than hang.** With `deferredResult` stubbed
to `Option.none()`, a workflow that awaits a `DurableDeferred` waits forever. So the engine **dies with
an explanatory defect** when it sees a `Suspended` result, instead of returning it and letting the
caller retry into a hang. Two constraints follow, to be enforced by lint:

- no `DurableDeferred` in a workflow body;
- no `DurableClock.sleep` over 60 s (shorter sleeps route through an in-memory `Activity`).

**`layerMemory` is not sufficient, and it is worth being clear why**, because the framework ships it
and it is tempting: its memo is a `Map` in one isolate. A Queues redelivery is a **new invocation**, so
everything it remembered is gone — which is the exact scenario the memo exists for. It is still useful
as a reference implementation and for unit tests, and this engine's `activityExecute` semantics are
ported from it, including the detail that a stored `Suspended` result is treated as a miss.

**Memoise `Complete`, never a defect.** A typed failure is a decided outcome — re-running the model to
get the same `UnsupportedDocument` wastes exactly the money the memo saves. A defect is either a bug
(re-running fails again, harmlessly) or a transient network failure (re-running is what you want).

## Revisit when

Approval chains need to be genuinely multi-step and durable — an escalation that waits three days for a
second approver, say. At that point Cloudflare Workflows is the answer, not a bigger engine.

## Note on this ADR's number

ADRs 0001–0008 were listed in the plan as step-0 work and were not written; 0009 onward were written as
the decisions were actually made. This one was written out of order, when the question it answers came
up. The remaining gaps are tracked in docs/PLAN.md.
