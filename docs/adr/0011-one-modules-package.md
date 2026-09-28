# ADR-0011 — One `@ea/modules` package, not eleven

**Status:** accepted · **Supersedes** the package-granularity decision in
[ADR-0010](./0010-slice-role-concept-enforcement.md) · **Date:** 2026-09-28

## Context

ADR-0010 created eleven packages, one per slice × role, on the argument that a package boundary turns
browser-safety and ring isolation from a checked rule into a fact of the module graph. That argument
is sound and the cost was stated in the same ADR: eleven `package.json` files and eleven
`tsconfig.json` files for roughly forty source files.

In practice the cost landed first and the benefit did not. Within one working session the eleven
manifests needed four rounds of edits — dropping deps knip flagged as unused, adding one back for a
test, re-pointing every `references` entry — none of which caught a design error. The boundaries the
packages were meant to enforce were all _already_ being caught by `bun run dep:check`, which reads
import specifiers and does not care whether a ring is a package or a directory.

The deciding observation: **this is one deployable, not a set of services.** Everything ships in a
single Worker from a single build. A package boundary is the right tool when artefacts are published
or deployed separately; here it was buying a compile-time guarantee that a 30-line script already
provides, and charging per-directory bureaucracy for it.

## Decision

One package, `@ea/modules`, containing every slice. The directory shape from ADR-0010 is unchanged —
it was never the problem:

```
packages/modules/<slice>/<role>/<Concept>/<Concept>.<facet>.ts
packages/modules/<slice>/<role>/<Concept>/<Operation>.ts
```

What goes away is the repetition: no `src/` per ring, no `package.json` per ring, no `tsconfig.json`
per ring, and one entry in the root project references instead of eleven. Tests sit in
`<slice>/<role>/test/`, beside the code they test.

Imports name the full path, so a call site still says which ring it is reaching into:

```ts
import { DocumentParser } from "@ea/modules/intake/domain/Document"
import { Db } from "@ea/modules/shared/tables/Database"
```

There is deliberately **no `"."` export**. Importing `@ea/modules` bare would pull every ring of
every slice into one module graph, `server/` included, which is exactly the coupling the rings exist
to prevent. The exports map is `"./*": "./*/index.ts"` plus `"./internal/*": null`.

## Consequences

**`scripts/boundaries.ts` is now the only thing keeping the rings apart.** Its rules moved from
package-name matching to directory matching (`ringOf(path)`), and the file says so at the top. It is
verified by a negative test rather than trusted: introducing a driver import into a domain file, a
`server` import into a use case, and a cross-slice import into `shared/tables` produces exactly three
failures, each naming its rule. That check should be run whenever the rules change.

**Browser safety now rests on the bundle assertion, not the module graph.** `better-auth` and `pg`
are dependencies of the same package a browser client imports its wire schemas from, so
tree-shaking is what keeps them out. The plan's assertion — the browser build must not match
`/better-auth|node:|pg-/` — stops being a formality and becomes the actual guarantee. It is not
written yet; it lands with the reference client at build-order step 1's remaining half.

**One genuine improvement fell out of it.** `tsconfig.json` keeps `types: []` for the whole package,
so `@cloudflare/workers-types` globals are not ambient anywhere in it. The R2 adapter therefore
declares the narrow shape it uses (`DocumentBucketApi`: one `put`, one `get`) instead of naming
`R2Bucket`. A real bucket satisfies it structurally, and so does a fake made of two functions — which
is better than what the eleven-package version had, where the adapter imported the binding type.

**What we give up, plainly:** the eval harness can no longer depend on `tables` while being unable to
reach `server`. It will import `@ea/modules/<slice>/tables/...` and be _able_ to import a store it
should not. `dep:check` does not police the harness today; if that becomes a real confusion, add a
rule for `evals/` rather than re-splitting the packages.

## Revisit when

A slice needs to ship or version separately from the Worker — a published client SDK is the likely
first case — or `dep:check` proves insufficient because someone works around it faster than it is
extended. Splitting back out is `git mv` plus a `package.json`, and the directory shape already
matches what the split would produce.
