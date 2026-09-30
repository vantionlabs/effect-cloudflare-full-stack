# ADR-0007 — Pulumi for infrastructure, not Alchemy, and the program has no Effect dependency

**Status:** accepted · **Date:** 2026-09-30 (supersedes `PLAN.md`'s choice of Alchemy)

## Context

`PLAN.md` chose Alchemy: TypeScript-native IaC where infrastructure and application code live in one program
wired by typed bindings, which is a genuinely better story than a separate program that declares resources the
Worker then names by string. The risk recorded there was its pre-1.0 state, with the mitigation "pin exactly,
commit state, `plan` on PR, keep wrangler as a fallback".

The risk that actually fired was a different one, and it fired immediately: **Alchemy's beta could not load on
`effect@4.0.0-rc.118`**. Diagnosed in `docs/runbooks/PatchingEffectDeps.md`.

## Decision

**A Pulumi program in `infra/`, in plain TypeScript, with no Effect dependency at all.**

The second half is the part worth an ADR. The natural instinct after choosing Pulumi is to reach for
`effect-pulumi` and keep one style across the repo — and that would **recreate the exact failure this decision
was forced by**, because `effect-pulumi` declares `effect: ^3.0.0` while this repo runs a v4 RC. A boundary rule
in `scripts/boundaries.ts` enforces the absence, so it cannot come back by a convenient import.

It costs nothing real: the infrastructure program shares no code with the Worker, so Effect would buy no
composition here. What it would buy is exposure to every RC churn, in the one program whose failure mode is a
half-applied deploy.

## Consequences

- **The Worker names its bindings by string**, in `wrangler.jsonc` and in `apps/worker/src/platform/Bindings.ts`,
  rather than importing them from the IaC program. That is the typed-bindings win given up, and it is why
  `scripts/bindings-check.ts` exists: it asserts every binding is consistent across environments and that every
  Pulumi resource kind is bound, which is the property Alchemy would have given by construction.
- **State lives on the local file backend**, so nothing depends on an external service — and `Pulumi.<stack>.yaml`
  is therefore **gitignored**, against Pulumi's usual convention, because local-backend encryption is too weak to
  commit credentials under. The consequence is that **CI cannot read stack config**, which it does not need to
  yet: CI deploys the Worker with wrangler and never runs `pulumi up`.
- **Applying infrastructure is a local, deliberate act.** Given the instruction not to create Cloudflare services
  ad hoc, that is closer to the intent than a pipeline that applies on merge.

## Status note, 2026-09-30: the Pulumi program is frozen

**Instruction: leave Pulumi alone. Provision through the Cloudflare MCP server or `wrangler` until Alchemy
supports the pinned Effect RC.** So the second revisit trigger below is the live one, and until it fires the
program in `infra/` is read-only history rather than the way a resource gets created.

Two consequences worth stating, because they are the cost of the freeze:

- **Resources created by MCP or `wrangler` are not in Pulumi's state.** A later `pulumi up` would see them as
  drift or try to create them again. So anything provisioned in this window is recorded in `docs/services.md`
  with the command or tool that made it, and adopting it back into the program means `pulumi import`, not a
  fresh `new`.
- **`scripts/bindings-check.ts` becomes more load-bearing, not less.** It was already the answer to "Pulumi
  gives no typed bindings"; with provisioning moving outside the program, comparing `wrangler.jsonc` against
  `Bindings.ts` is the only mechanical check left. Its stated blind spot — a binding pointing at a resource
  nobody created — is a real hole and stays one.

  An earlier version of this bullet claimed that hole was "now the _likely_ failure rather than a theoretical
  one", on the strength of the AI Gateway appearing to be missing. **It was not missing** (services.md §7),
  and the claim went with it. The blind spot is unchanged either way: the check compares declarations against
  declarations, so it would pass whether or not the resource exists. What was wrong was treating a guess about
  one resource as evidence about the check.

Note that this does not change the decision recorded above: Pulumi was chosen because Alchemy would not load,
and it still will not. This is a decision to stop _editing_ the program, not to replace it.

## Revisit when

- **Alchemy loads on the pinned Effect version.** The typed-bindings argument was always the better one; it was
  never available. Re-test on an Effect bump rather than assuming.
- **CI needs stack config** — the first time a resource must be created by a pipeline. Then move to Pulumi Cloud
  or an R2 backend with a real `PULUMI_CONFIG_PASSPHRASE`, commit the stack files, and drop them from
  `.gitignore`. Do that as one change; a half-migrated backend is the worst state.
- **`bindings-check` stops being enough.** It compares declarations, not reality. A binding that exists in
  `wrangler.jsonc` and points at a resource nobody created still passes, and the symptom is a runtime failure on
  the first request that touches it.
