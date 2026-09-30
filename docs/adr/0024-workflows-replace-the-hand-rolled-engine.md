# ADR-0024 — Cloudflare Workflows replace the hand-rolled `WorkflowEngine`

**Status:** accepted · **Date:** 2026-09-30 · **Revises** [ADR-0003](0003-workflow-engine-placement.md), whose
revisit trigger has fired

## Context

ADR-0003 chose a ~200-line Postgres `WorkflowEngine` (now 298 lines) with suspend deliberately stubbed, and
named the trigger to revisit: _"if approval chains ever need to be genuinely multi-step and durable"_ → Cloudflare
Workflows. It rejected Workflows at the time for inverting the relationship — a `WorkflowEntrypoint`'s
`run(event, step)` is async, so Effect runs _inside_ steps rather than _being_ the workflow.

Two things changed. The trigger fired: human-paced flows — wait three days for an approval, wait for a webhook,
escalate after 48 hours — are table stakes for client work, and the engine cannot express any of them.
And the property the engine exists for turned out to be native.

## The measurement

`apps/worker/test/WorkflowStepMemo.test.ts`, in real `workerd`. A two-step Workflow whose **second** step fails
on its first attempt and succeeds on its retry:

```
step "one":  executed 1 time     ← had already completed; not re-run
step "two":  executed 2 times    ← failed once on purpose, then succeeded
```

That is exactly what `activityExecute` hand-rolls, and it keys the same way: the Rules of Workflows say _"step
names act as the 'cache key' in your Workflow"_ and _"successfully cached steps do not re-execute"_, where ours
keys on `(execution_id, name, attempt)`.

**Verified by execution rather than by reading**, which is the move ADR-0009 made for the `cloudflare:sockets`
driver — and the probe is its own Worker with its own wrangler config, so proving it cost no production surface.

## Decision

**Workflows own durable execution. The 298-line engine goes.** And the rule for which model, because there are
now two:

> **No waiting → `effect/workflow` semantics are unnecessary; use Workflows' `step.do`. Waiting on a human or an
> external event → Workflows' `waitForEvent`.** Anything that would need a third model needs an argument first.

What this buys beyond the memo: `waitForEvent` up to a year, `pause()`/`resume()`/`restart()`/`terminate()`,
retries with configurable backoff, and **deleting code we maintain with no conformance suite** — risk R7, whose
whole mitigation was to shrink the contract by stubbing suspend.

## What constrains the migration

Four Rules of Workflows, each with a consequence here:

| Rule                                                                                          | Consequence                                                       |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| _"Non-serializable resources, like a database connection, should be executed outside"_ a step | the connection opens in `run()`, and steps use it                 |
| A non-stream step return persists up to **1 MiB** (2^20 bytes)                                | fine for an extraction; a large retrieval goes to R2 by reference |
| Step timeouts **≤ 30 minutes**; use `waitForEvent` beyond                                     | the human pause is an event, never a sleep                        |
| Step names are the cache key, so **deterministic**                                            | `Extract`/`Retrieve`/`Decide`/`Judge` already are                 |

**Default retry behaviour is undocumented**, so every step sets retries explicitly.

## What this costs

- **The typed error channel across steps.** A step boundary is a `Promise`, so `Terminal.ts`'s
  terminal-versus-retryable union — which the queue consumer branches on to decide ack or retry — moves into a
  catch at the step boundary. That is the real loss, and the migration must keep the classification observable.
- **Each step is still an `Effect`** run on the memoised runtime, so `Db.scoped` requiring `CurrentOrg` — the
  tenancy seam — survives inside a step. Composition _between_ steps is what goes, and for a four-activity
  linear pipeline that is the cheapest place to lose it.
- **Steps are now a metered dimension** (billing from 10 Aug 2026): 3,000/day free, 500,000/month on Paid then
  $0.80 per additional 100,000. At four steps per document that is 750 documents/day free and 125,000/month
  paid — cheap, but it argues against splitting the pipeline finer than the activities that already exist.
- **Portability**, as ADR-0023 records.

## Status note, 2026-09-30: two things in this ADR were wrong, and execution said so

Both were found by building the entrypoint and testing it, which is the method this ADR argues for — so
they are recorded rather than edited away.

**"The connection opens in `run()`, and steps use it" does not fit an Effect body.** A `step.do` callback is
an `async` function, so a single Effect scope cannot span the steps without inverting control — awaiting
each step's promise from inside the scope and providing the captured `SqlClient` to each one. That is
possible and buys one connection per instance instead of one per step that needs the database, which is two
of four. It is not worth the inversion: Hyperdrive opens in single-digit milliseconds, the steps are
sequential so the six-connection cap is never approached, and the Rule's real concern — a non-serializable
resource crossing a step boundary — holds either way, because no connection is ever returned from a step.
Each bound work function opens its own, exactly as every HTTP request already does.

**The memo is not what the table above implied, and this one changed the design.** The probe's result was
read as "`run()` re-executes from the top and completed steps are skipped". It is not: **an error outside a
`step.do` fails the instance with no retry, and a step retry resumes at the failed step without re-entering
`run()`.** Measured — the first entrypoint ran the rails and the write outside any step and the instance
ended `errored` with every counter at 1.

So the rule this ADR should have stated is: **anything that needs a retry goes inside a step, and a step must
therefore be idempotent.** The rails-and-write half is a step now, and the decision insert became a claim
(`on conflict … do nothing returning id`) so that a retry after a partial success is safe. The original
reason for keeping the rails out of a step — that a memoised rail could be replayed past a tightened one —
survives as a real but smaller concern: a cached step result is replayed only within one instance, which is
one decision, and the short circuit already returns older decisions without re-railing them.

`docs/references.md` carries both measurements.

## Revisit when

- **A pipeline needs branching or dynamic routing.** Workflows is step-sequential; that shape is LangGraph's,
  and ADR-0023 names the trade.
- **Step billing changes materially**, since granularity is now a cost rather than only a design choice.
- **`effect/workflow` gains a Cloudflare-backed engine upstream.** ADR-0003 noted
  `@effect/platform-cloudflare` was building one; if it lands, the inversion this ADR accepts may be
  unnecessary.
