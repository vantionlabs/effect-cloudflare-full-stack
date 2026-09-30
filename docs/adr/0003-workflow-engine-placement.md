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

**1. `@effect/platform-cloudflare` publishes its `CloudflareWorkflowEngine`.** This is new since the ADR
was written and is now the most likely trigger, so it goes first.

[Effect-TS/effect#7322](https://github.com/Effect-TS/effect/pull/7322) adds
`CloudflareWorkflowEngine.ts` — an official `WorkflowEngine` backed by Durable Objects, with its own
storage, runtime, registry and wire, plus unit and integration tests. Open since 2026-08-18, +14,344
lines, several slices already merged. Not published to npm as of 2026-09-29 (`references.md` has the
dated check), and the maintainers have asked for no feedback yet.

Why it matters more than "a maintained alternative to 200 lines we own":

- **It would lift both lint-enforced constraints.** Ours stubs `deferredResult` and `scheduleClock`, which
  is _why_ `DurableDeferred` and `DurableClock.sleep > 60 s` are banned. A DO-backed engine has alarms, so
  both become available — and that is precisely the durable-suspend capability trigger 2 below was
  written for. The trigger it anticipated (Cloudflare Workflows) may arrive as an Effect-native engine
  instead, which is a strictly better answer because the workflow body stays an Effect rather than
  inverting into a `WorkflowEntrypoint` class.
- **The forgeable-token objection does not go away.** A `DurableDeferred` token is still unsigned
  base64url of `[workflowName, executionId, deferredName]`. Adopting the engine does not mean adopting
  suspend for the approval boundary; docket's §6 argument for "the human pause is a database row" stands
  on its own and should be re-argued, not assumed to have expired.
- **The decision is cheap to reverse**, and that was designed in: `WorkflowEngine` is the seam, the
  pipeline is four named activities, and `DecideDocument` never mentions Postgres. Swapping engines is a
  layer change plus a data migration for in-flight executions.

What to check when it lands: that it runs without `effect/cluster`'s sharding loops (the reason cluster
itself was rejected), what it costs per execution in DO requests and storage against a Postgres row, and
whether `activityExecute`'s memo is atomic under a Queues redelivery in the way a Postgres `ON CONFLICT`
is.

**2. Approval chains need to be genuinely multi-step and durable** — an escalation that waits three days
for a second approver, say. At that point a durable suspend is required, and the answer is
`CloudflareWorkflowEngine` if it has shipped, or Cloudflare Workflows if it has not. Not a bigger engine
of our own.

## What has since been confirmed

Two of this ADR's load-bearing readings were made from the source and have since been stated outright by
an Effect maintainer (office hours 2026-09-26, `references.md`):

- **`effect/cluster` is for persistent servers, not serverless** — _"right now cluster is really designed
  for persistent servers. So it's not really compatible with serverless architecture right now."_ That is
  the conclusion this ADR reached by counting `sql.withTransaction` calls and reading the sharding loops.
- **Writing an engine was the only option** — _"right now we only have a cluster workflow engine. We have
  an in-memory one too, but that's not really durable."_ So this was not a wheel already available.

Also confirmed: workflows are independent of cluster, and a third-party engine is an intended extension
point. The parts of this ADR now dated by external work are the _alternatives_, not the analysis.

## Note on this ADR's number

ADRs 0001–0008 were listed in the plan as step-0 work and were not written; 0009 onward were written as
the decisions were actually made. This one was written out of order, when the question it answers came
up. The remaining gaps are tracked in docs/PLAN.md.

## Status note, 2026-09-30: superseded and executed — the engine is deleted

ADR-0024 fired this ADR's revisit trigger; this records that the migration is finished. `WorkflowEnginePg`
and its 298 lines are gone, and with them **risk R7** — "the custom `WorkflowEngine` is ours to maintain,
with no exported conformance suite."

What replaced each thing it did:

| The engine did                    | Now                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| memoise completed activities      | the platform, keyed on step name — proven in `workerd`, not assumed                       |
| `execute`'s run-level idempotency | `existingDecision` reading `decisions` by `decide_key`, which is earlier and prunes never |
| stub suspend deliberately         | `waitForEvent`, which is the capability the stub was standing in for                      |

**What was genuinely lost**, stated because this ADR's value was always its honesty about trade-offs: in
Node there is no memo at all, so a run that fails part way through re-extracts on the next attempt. That
affects the eval harness and the test suite rather than production, and `DecideDocument.ts` says so at the
point where a reader would otherwise wonder.

The two tables the engine wrote — `workflow_executions` and `workflow_activities` — are left in place.
Dropping a table is irreversible and they hold the audit trail of every decision made before this change.
