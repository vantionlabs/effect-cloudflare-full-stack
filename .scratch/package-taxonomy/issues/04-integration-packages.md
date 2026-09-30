# Move better-auth and OpenAI into integration packages

Status: done

These are the split that actually contains a dependency, and they already exist as adapters:

| Package                             | Owns                | Currently in            |
| ----------------------------------- | ------------------- | ----------------------- |
| `packages/integrations/better-auth` | `better-auth`, `pg` | `iam/server/Session/*`  |
| `packages/integrations/ai-openai`   | `@effect/ai-openai` | `shared/server/Model/*` |

## The pattern, for the vendors that come next

The PORT stays in the feature slice's domain; the adapter implements it; `apps/worker` wires them. So Stripe is
`modules/billing/domain/Payments.ts` plus `packages/integrations/stripe`, and Twilio is
`modules/notify/domain/Sms.ts` plus `packages/integrations/twilio`.

**An integration with no dependency does not get a package.** A documented HTTP endpoint called with `fetch` is a
`server`-ring file in the slice that owns the port; a package for it would be the per-ring bureaucracy ADR-0011
rejected.

## Done looks like

`@ea/modules` no longer depends on `better-auth`, `pg` or `@effect/ai-openai` — readable from its manifest, which is
the check. `bun run bundle:check` still passes, and now for a structural reason rather than because tree-shaking
happened to work.

## Comments

Done. `@ea/modules` now declares `effect`, `uuid`, `@ea/domain`, `@ea/database` and nothing else, with
`@effect/sql-pg` and `vitest` as devDependencies — `better-auth`, `pg` and `@effect/ai-openai` are gone from the
manifest, which was the stated check.

Named `ai-openai` rather than `openai`, matching the SDK (`@effect/ai-openai`) rather than the vendor, because the
package is the Effect adapter and a future `@effect/ai-anthropic` would sit beside it under the same rule.

**Two rules were added to `scripts/boundaries.ts`, because the move silently widened a hole.** The existing rule
"nothing but the composition root may reach into a server ring" matches `@ea/modules/<slice>/server`, so lifting
these files OUT of `iam/server` and `shared/server` took them out of its reach: a use case could have imported
`@ea/better-auth` and put the SDK straight back into the graph the packages exist to keep it out of. So:

- _nothing but the composition root may name an integration_ — `@ea/better-auth` and `@ea/ai-openai` are importable
  only from `apps/worker/src` composition-root files (and `evals/`, which is a composition root of its own).
- _an integration implements ports, it does not use features_ — an integration may reach a domain ring, but not a
  `use-cases`, `tables` or `server` ring, and not `@ea/api`.

Negative-tested by adding `import { authSettings } from "@ea/better-auth/Session"` to
`chat/use-cases/Message/PostMessage.ts` and confirming `dep:check` names the file, the import and the rule; then
reverted. `dep:check` went from 772 to 1015 file-rule checks.

**knip caught a dependency I added and never used:** `packages/api` declared `@ea/better-auth`. Removing it was
required twice over — it was dead, and the new rule forbids `packages/api` from naming an integration at all.
`apps/worker/src/Main.ts` is now the only importer of either package, which is the property the rule asserts.

Gates: `bun run preflight` green (287 tests, 27 files), `bun run test:e2e` green (8 tests), `bundle:check` clean —
and it now holds structurally rather than by tree-shaking, as the issue asked.
