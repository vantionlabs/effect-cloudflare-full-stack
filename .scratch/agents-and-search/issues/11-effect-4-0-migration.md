# Migrate from effect 4.0.0-rc.118 to 4.0.0 (stable)

Status: claimed (code done on branch `effect-4.0.0`; resolve after the AI-dependent re-run, see Answer)
Type: task

Effect 4.0 was released 2026-09-30 (https://effect.website/blog/releases/effect/40); npm `latest` is `4.0.0`, git
tag `effect@4.0.0` (67ba4e46). Migration guide: https://github.com/Effect-TS/effect/blob/main/MIGRATION.md.

Scope: the four `catalog:` pins in the root package.json (`effect`, `@effect/ai-openai-compat`, `@effect/atom-react`,
`@effect/sql-pg`) plus anything else on the RC; the vendored source at `repos/effect` moved to the same tag with
`git subtree pull --squash` (AGENTS.md); every compile/test break fixed at its cause; AGENTS.md and
docs/references.md updated where they name the version or an API that moved.

Done in a separate worktree and branch so main keeps moving; merged only when preflight and the e2e suite are green.

## Answer

2026-10-01, branch `effect-4.0.0` (not pushed, not merged).

**Versions.** `effect`, `@effect/sql-pg`, `@effect/atom-react` and `@effect/ai-openai-compat` moved from
`4.0.0-rc.118` to `4.0.0`. Nothing else in the repo was on the RC: `@effect/vitest` is not a dependency (see
`vitest.config.ts`), and `@effect/tsgo` (0.46.1; npm has 0.47.2) is versioned separately and decides oxlint's
range, so it stayed. `repos/effect` moved to `effect@4.0.0` (67ba4e46) with the `git subtree pull --squash`
command from AGENTS.md. `syncpack lint` is clean.

**Code changes: none were needed.** The rc.118 to 4.0.0 changelog has a few changes that could break callers:
`Schema.brand` takes one identifier and is type-only, `partition` returns its tuple swapped, plus changes to
`Queue.State.takers`, `RpcMessage.ExitEncoded`, the `TestSchema` rename and WebSocket close codes. None of
them touches this code. `docs/references.md` lists each one, dated, with where it lands. The export map is
unchanged (the same 28 paths), and the symbols in `docs/effect-v4-api-notes.md` still import at 4.0.0.

**Gates.**

- `bun run check`: green.
- Console build, then `preflight`: format, lint and hygiene (knip, syncpack, deps:workspace, secretlint,
  boundaries, bindings, bundle, auth) are green. Tests: **560 of 561 pass**. The one failure,
  `IndexDocument.test.ts` "chunks and embeds…", got `embedded = 0` because every `@cf/baai/bge-m3` call
  returned 429 with code 4006: the daily free Workers AI allocation is used up. Source: the AI Gateway logs
  for `effect-ai-ai-dev`.
- e2e on a dedicated dev server (:5180): **30 of 39 pass**.
  - Six failures need the model: ask ×2, insights "answered from the data", planning "accepted quote…" and
    sales ×2. All 24 model calls in that window returned 429/4006.
  - Three more failed on an input that was still disabled after 5 s (the hydration wait). On a re-run,
    planning "one-off expense" passed. Both insights tests got past the input and then failed on the model
    call (429/4006).

**Still to verify:** once the neuron allocation resets, re-run `IndexDocument.test.ts` and the eight
AI-dependent e2e specs (the six above plus the two insights tests). If they pass, mark this resolved.
