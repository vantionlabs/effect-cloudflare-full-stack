# ADR-0014 — No row-level security; the `Db.scoped` seam plus a static check

**Status:** accepted · **Date:** 2026-09-29 · **Supersedes** ADR-0005 (which never got written, but the
decision it would have recorded — "RLS _and_ app-layer, neither trusted alone" — was implemented and is now
reversed)

## Context

The tenancy design had two independent nets: row-level security policies on all 11 `organization_id` tables,
and an explicit predicate in every query. It was removed, for three reasons that arrived together.

**1. Its premise was partly wrong.** The objection raised was "better-auth already provides this through
organizations". Reading better-auth's own documentation settles what it does provide:

> "This is a membership and permission management system, not a multi-tenant data isolation layer.
> Developers must manually enforce organization-scoped queries in their application code."

So better-auth does **not** remove the need for scoping — it supplies `activeOrganizationId`, roles and
`hasPermission()`, and knows nothing of our tables. But it does mean the _organization_ is not ours to model,
which narrows what we have to build to the isolation itself.

**2. The machinery could not run on the managed provider.** RLS is bypassed by superusers and, unless forced,
by a table's owner — so the design needed a non-superuser role (`effect_ai_app`) and `set local role` on every
transaction. PlanetScale issues a restricted `pscale_api_*` role with no `CREATEROLE`. The role could not be
created, which meant the grants and the `SET` could not run either.

**3. The cost was ongoing.** Eleven policies and eleven grants, plus a `force row level security` per table,
plus remembering all of it for every new table — a second thing to keep in step, forever, in a codebase whose
migrations are already the largest surface.

## Decision

**Isolation comes from `Db.scoped` plus a static check. There is no RLS.**

What the seam guarantees, and it is the part worth having: every method hands `orgId` to its callback, and
**none accepts one as an argument**. There is no overload taking an `orgId`, so a caller cannot name a tenant —
the organization comes from the authenticated session (`CurrentUser`) or from an explicit non-interactive tag
(`CurrentOrg`), never from a parameter a bug or a crafted request could influence. That is structural.

What it does not guarantee: a query that omits `and organization_id = ${orgId}` returns other tenants' rows.
Under RLS it returned nothing.

### What replaces the net

`bun run dep:check` fails any statement touching a tenant table without the predicate — reads, updates and
deletes need a `WHERE`; inserts need the column supplied.

**That check was not a formality when it was written. It found 16 statements across 8 files with no
predicate**, including reads of `extractions` and `workflow_activities` — both of which hold extracted invoice
fields. RLS had been silently carrying all sixteen. They were fixed, and the predicates were verified _with
RLS still enabled_ before it was removed, so they are proven independently rather than on trust.

### What the tests say now

Three things changed shape, and the third is the one to read:

- The structural test that asserted every table had a policy is gone; there is nothing in the catalogue left
  to inspect.
- The behavioural tests now assert the part that is genuinely ours — that `Db.scoped` supplies the
  _authenticated_ organization — rather than that Postgres filters on a predicate we wrote in the test.
- **The fail-closed test was inverted rather than deleted.** It used to assert that a query escaping the seam
  returned zero rows. That is now false, so it asserts the opposite: such a query sees every tenant's rows. If
  it ever fails, fail-closed behaviour has been restored, and the instruction is to update this ADR rather
  than to fix the test.

### One consequence worth naming separately

`retrieve_policy` filtered on `current_org()`, a transaction-local GUC that the policies also read. With RLS
gone the GUC had no other reader, so the function takes the organization as a **parameter** now. It had to be
dropped and recreated rather than replaced, because adding an argument creates an _overload_ — and the old
`current_org()` version would have returned every tenant's policy once the GUC stopped being set. A stale
overload would have been far worse than a failed migration.

## Consequences

**The weakest link is now a lint rule.** That is a real reduction in defence, and it is accepted knowingly
rather than because the risk was reassessed downward. A forgotten predicate is a cross-tenant leak, and it has
happened once in this codebase already — `Intake.list`, which had neither the predicate nor working RLS.

**What was gained:** eleven policies, eleven grants, a role, a `SET` per transaction and the provider
incompatibility all go away. Migrations get materially smaller and a new table needs one fewer thing
remembered.

## Revisit when

A client's requirements make a lint rule an insufficient answer — a security review, a penetration test
finding, or a regulated deployment. Restoring it is additive: the predicates stay, the policies come back
alongside them, and the connecting role becomes a deployment question rather than a migration one. Worth
knowing that PlanetScale's restricted role is arguably _better_ for RLS than the local superuser was, since
`FORCE` is then unnecessary.
