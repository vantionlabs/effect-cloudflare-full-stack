# Move better-auth and OpenAI into integration packages

Status: ready-for-agent

These are the split that actually contains a dependency, and they already exist as adapters:

| Package                             | Owns                | Currently in            |
| ----------------------------------- | ------------------- | ----------------------- |
| `packages/integrations/better-auth` | `better-auth`, `pg` | `iam/server/Session/*`  |
| `packages/integrations/openai`      | `@effect/ai-openai` | `shared/server/Model/*` |

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
