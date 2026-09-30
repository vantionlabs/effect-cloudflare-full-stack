# ADR-0021 — Packages by kind: features, capabilities, integrations

**Status:** accepted, not yet executed · **Refines** [ADR-0011](./0011-one-modules-package.md) · **Date:** 2026-09-30

## Context

ADR-0011 collapsed eleven packages (one per slice × ring) into one `@ea/modules`, on the measured observation that
the per-ring manifests cost four rounds of edits in one session and caught nothing `dep:check` was not already
catching. That reasoning holds and this ADR does not reverse it.

What is proposed here is a **different cut**: not one package per ring, but a few packages by _kind_. Three things
make it worth doing now.

**1. `packages/modules` has stopped meaning one thing.** It holds features (`decision`, `intake`, `policy`), a
database seam, an identity seam, a realtime transport, and vendor adapters for better-auth and OpenAI. "Module"
has come to mean "any code that is not the app", which is not a category anybody can use to decide where a new
file goes — and the question "where does Stripe go?" has no answer in the current layout.

**2. The guarantee ADR-0011 traded away was never replaced, and the bill came due.** That ADR said browser safety
"now rests on the bundle assertion, not the module graph". The assertion existed only as a sentence in PLAN.md. It
was finally written, and on its first run it found that the browser bundle contained **every `create table`
statement in the repo**: the `Db` seam and the migration manifest shared a barrel, a barrel is transitive, and the
console imports `Db` through `@ea/api`. One barrel, one deployable, one silent leak.

**3. The dependency weight is not where it looked.** Extracting a database package moves **no** heavy dependency:
`Db.ts`, `Connect.ts` and `TextArray.ts` import only `effect` and `effect/sql`. The dependencies that must not
reach a browser are carried by exactly two files:

| Dependency          | Only importer                                          |
| ------------------- | ------------------------------------------------------ |
| `better-auth`, `pg` | `iam/server/Session/BetterAuth.ts`                     |
| `@effect/ai-openai` | `shared/server/Model/LanguageModelOpenAiCompatible.ts` |
| `@effect/sql-pg`    | tests only, correctly a devDependency                  |

So better-auth and OpenAI are already the first two **integrations**, and they are the split that would contain
something.

## Decision

**Three kinds of package, and a one-line rule for which is which.**

> A package boundary exists to contain a DEPENDENCY or to forbid a DIRECTION.
> A ring boundary exists to order code inside one deployable.

```
packages/
  domain/        identity, ids — primitives every layer shares, importing nothing but effect
  database/      the Db seam, Connect, TextArray
  realtime/      the socket: presence, fan-out, the upgrade, ping/pong
  modules/       FEATURES: decision, intake, policy, iam, chat
  api/           the contract manifests and transport edges
  integrations/  one package per vendor, each owning its SDK
    better-auth/  openai/  stripe/  twilio/
apps/worker      the entrypoint (ADR: see AGENTS.md, "What stays in apps/worker")
```

**Capability packages** (`domain`, `database`, `realtime`) exist to forbid a direction: they are imported by every
feature and must never import one. Today nothing enforces that — `Db.ts` could import a decision type tomorrow and
only a reviewer would notice.

**Integration packages** exist to contain a dependency. `packages/integrations/stripe` owns `stripe`, so no other
package can reach it even by accident, and the browser bundle cannot contain it by construction rather than by
tree-shaking. The **port stays in the feature slice** (`modules/billing/domain/Payments.ts`); the adapter
implements it; `apps/worker` wires them. A vendor swap becomes a package swap, and `knip` and `syncpack` see each
SDK where it is actually used.

**Where an integration does NOT get a package:** when it brings no dependency. An HTTP call with `fetch` against a
documented endpoint is a `server`-ring file in the slice that owns the port, and inventing a package for it would
be the per-ring bureaucracy ADR-0011 rejected.

## Two findings that constrain the execution

**`@ea/database` cannot exist without `@ea/domain`.** `Db.scoped` requires `CurrentUser`, `CurrentOrg` and `OrgId`
— it is the thing that enforces tenancy, so it needs the identity seam. Extracting database while identity stays in
modules is a cycle. Hence `packages/domain` is first, not optional.

**Splitting `realtime` requires the transport to become payload-agnostic.** `RoomFrame.ts` imports chat's `Message`,
and `Rooms.broadcast` takes a `ServerFrame`. So a realtime package would depend on a feature. The fix is better than
a workaround: `broadcast` carries an **opaque encoded payload**, each slice owns its own frames (chat owns
`MessagePosted`, decision owns `QueueChanged`), and `@ea/api` assembles the frame union exactly as it already
assembles `RpcV1`. A transport has no business knowing what a `QueueChanged` is.

## Consequences

- **More manifests than one, fewer than eleven.** Six packages, split on lines that carry meaning. ADR-0011's cost
  was per-ring repetition for ~40 files; this is per-kind, and each boundary answers a question that has actually
  been asked.
- **`dep:check` rules keyed on paths need rewriting.** Several name `packages/modules/shared/domain` explicitly,
  including the message that tells you where a cross-slice type belongs. The check is the thing that has been doing
  the work, so its rules moving is the real cost of this change.
- **The bundle check stays the safety net**, because packages do not make tree-shaking correct — they make the
  graph narrower. The leak it found was a barrel inside one package, and that failure mode survives any split.
- **Import paths get shorter and truer.** `@ea/modules/shared/tables/Database` becomes `@ea/database` — a path that
  currently says "shared tables" for something that is neither.

## Revisit when

- **A capability package starts wanting a feature type.** That is the signal the cut was wrong, not that the rule
  should bend.
- **An integration has no dependency to contain.** Then it is a `server` ring file, and adding a package for it is
  the mistake ADR-0011 named.
- **The manifests need a third round of edits that catches nothing.** That was the measurement that killed eleven
  packages; it applies equally to six.
