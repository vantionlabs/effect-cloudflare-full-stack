# ADR-0010 — slice × role × concept, and the three places it bends

**Status:** accepted; the package-granularity decision below is **superseded by
[ADR-0011](./0011-one-modules-package.md)** (one `@ea/modules` package). The directory shape,
the three bends and the enforcement all stand. · **Date:** 2026-09-28

## Context

The plan specified `beep-effect`'s slice × role × concept layout with a closed facet-suffix
vocabulary. Milestones 0–4 were built with a flattened one (`packages/shared/domain/src/intake/`,
no facet suffixes, no concept folders), which quietly cost the two properties the convention exists
for: `rg --files -g '*.table.ts'` returned nothing, and a slice's domain lived inside the package
reserved for cross-slice code. This ADR records the restructure and the three judgment calls it
forced, because each one is a place a later reader would otherwise assume drift.

## Decision

Eleven packages named `@ea/<slice>-<role>`, one per slice × role, each containing PascalCase
concept folders whose files carry a facet suffix or are a named operation:

```
packages/<slice>/<role>/src/<Concept>/<Concept>.<facet>.ts     e.g. Document.table.ts
packages/<slice>/<role>/src/<Concept>/<Operation>.ts           e.g. IngestUpload.ts
```

Rings are lowercase (`domain`, `tables`, `use-cases`, `server`), concepts are PascalCase. The app's
own directories follow the same rule: `apps/worker/src/Health/Health.rpc.ts` beside the
`platform/` ring.

### Bend 1 — `Identity` and `Authenticated` live in `shared/domain`, not `iam/domain`

`CurrentUser` appears in the `R` of every tenant-scoped store in every slice, and `Authenticated` is
the middleware that _provides_ it, so every protected group needs both. Putting them in the `iam`
slice would make `@ea/intake-domain` depend on `@ea/iam-domain` just to mark an endpoint
authenticated — a cross-slice dependency for a cross-slice contract. The plan's own layout line
agrees (`shared/domain/ Identity/ …`). The **implementation** stays the iam slice's
(`@ea/iam-server`); only the contract is shared.

### Bend 2 — `api` is a fourth role

The versioned wire surface is cross-slice by nature: `ApiV1` composes `HealthGroup`, `MeGroup` and
`IntakeGroup`. It has no home in beep's `domain | tables | use-cases | server | ui` vocabulary, so
`packages/shared/api` is added as a role. Each group lives with its slice (so a slice stays whole:
its contract, model and errors together) and only the composition is central. Nothing in
`shared/domain` or `shared/tables` depends on it, so the dependency direction stays acyclic.

### Bend 3 — exactly two files may name every slice

`bun run dep:check` forbids any package importing another slice, with two named exemptions:

| File                                                | Why                                                             |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `packages/shared/api/**`                            | composing the slices' groups is its entire job                  |
| `packages/shared/tables/src/Database/Migrations.ts` | migration _order_ is global; there can only be one answer to it |

Both are allow-listed by path rather than by pattern, so adding a third is a visible diff.

## Consequences

- **Enforced, not remembered.** `dep:check` now also asserts that nothing but `apps/worker/src/Main.ts`
  imports an `@ea/*-server` package, and that a `tables` ring never names a driver.
- **Two ports were extracted to make the moves possible**, and both are improvements rather than
  concessions:
  - `Connect` (`@ea/shared-tables/Database`) replaces the Worker-local `withDatabase`. Its `open`
    requires a `Scope`, which turns "a connection must not outlive its request" from a comment that
    was violated twice into a fact the compiler checks. The driver now appears in exactly one file.
  - `Blobs` split into a port (`@ea/intake-domain/Document`) and an R2 adapter
    (`@ea/intake-server/Document`) that takes a single `R2Bucket` rather than the whole Worker `Env`.
    A slice asks for what it needs; `Main.ts` is the only holder of the wide environment.
- **Cost, stated plainly:** eleven `package.json` files and eleven `tsconfig.json` files for roughly
  forty source files. That ratio only pays off as slices grow. It is accepted because splitting later
  is cheap in principle and expensive in practice — every import in the repo changes — and because
  `decision` and `policy` (the two largest slices) are still unwritten.

## Revisit when

A role directory has been empty for two slices running, or the package count starts costing more in
`bun install` churn and manifest edits than the enforced boundaries return.

---

## Revision, 2026-09-29: the facet suffixes are dropped

**Status of this ADR:** the slice × role × concept _structure_ stands and is enforced. The **facet suffix
vocabulary is withdrawn.**

Files are now plain PascalCase with the filename equal to the primary exported symbol, and no dots:
`Decision.model.ts` → `Decision.ts`, `Decision.table.ts` → `DecisionTable.ts`, `Session.live.ts` →
`SessionLive.ts`, `Identity.middleware.ts` → `Authenticated.ts`. 46 files renamed.

**Why, and what the original argument got wrong.** The suffixes were justified by greppability — _"`rg
--files -g '*.table.ts'` is every table; `-g '*.rpc.ts'` every transport surface"_. That was true and it
was not load-bearing, because **nothing actually used it.** `scripts/boundaries.ts` keys on ring
_directories_ (`/tables/`, `/domain/`, `/server/`), not on filename suffixes — which is strictly better,
since a file cannot be in the wrong directory without the move being visible in a diff, while a suffix is
a claim a file makes about itself.

So the vocabulary was a second naming system to keep in step with the first, buying a search that a
directory glob already answers. `rg --files packages/modules/*/tables` is every table.

**What was verified before the rename, not after.** The concern was that dropping the suffixes would
silently break the boundary rules. It did not — but checking produced a better finding: the tenant
predicate rule matched `sql` templates with `/sql(?:<[^>]*>)?`/`, which stops the row-type annotation at
the first`>`. A statement whose generic spans lines or nests never matched, and an unmatched statement is
**silently skipped**. Measured on fixing it: **26 tenant statements seen before, 30 after.** The four it
had never read included two reads of`decisions`in`ListQueue`and the`rules` read that rail 3's
condition evaluation depends on.

That bug was found by a negative test that kept passing — patching a statement to use a caller-supplied
organization produced no failure, because the rule was not reading the statement at all. Which is the
general lesson worth keeping from this revision: **a check that has never been seen to fail is not a
check**, and that applies to the suffix convention too. It was never tested because nothing depended on it.

**Revisit when** a tool genuinely needs to select files by role _within_ a directory — a codegen step, or a
bundler rule that cannot express a path. Then reach for a directory, not a suffix.
