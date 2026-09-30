# ADR-0005 — Org scoping: reserved for "RLS **and** the app layer", and superseded before it was written

**Status:** superseded by [ADR-0014](0014-no-rls-scoping-in-the-seam.md) · **Date:** 2026-09-30

## Why this file exists rather than the ADR it was reserved for

`PLAN.md` reserved 0005 for the tenancy decision, described as _"RLS **and** app-layer, neither trusted
alone"_, with the revisit trigger _"never — this one is load-bearing"_. It was the most confidently held
decision in the plan.

**It was wrong, and it was found to be wrong by running it**, which is recorded in ADR-0014: the local Worker
connects as the bootstrap user, and **a superuser bypasses RLS whatever `FORCE ROW LEVEL SECURITY` says**. So
the second net was not a second net. It was a policy that could not fire in the environment where the first
tests ran, and a tenancy test connecting as the app role could not discover that production did not.

The decision as it actually stands is ADR-0014: **the `Db.scoped` seam, plus a static check**. Read that one.
Two things about it are worth knowing before touching tenancy code, and both are reasons this number is not
simply deleted:

- `scripts/boundaries.ts` enforces the tenant predicate **statically**, so a query that does not go through
  the seam fails a gate rather than a test. The exemptions are explicit and each carries a reason — two
  today, both in the event path, where "which organization" is the answer rather than the filter.
- **ADR-0014 contains a withdrawn reason, kept visible on purpose.** It is the repo's worked example of
  withdrawing an argument in place instead of editing it out, which is what `AGENTS.md` asks for.

Leaving 0005 unallocated would have been tidier and would have lost the more useful fact: that the plan's
most certain decision is the one that did not survive contact, and that the trap which killed it
(a superuser silently ignoring RLS) is in `AGENTS.md` because it costs real debugging time to notice.

## Revisit when

Never on its own. If RLS is reconsidered, it is a revision of ADR-0014, and the first question is the one that
defeated it here: **which role does each environment actually connect as**, including the local Worker and CI.
