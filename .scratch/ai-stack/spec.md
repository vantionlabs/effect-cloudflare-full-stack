# The AI stack

Decided 2026-09-30, recorded as ADR-0023 (the stack and the four choosing rules) and ADR-0024 (Workflows
replace the hand-rolled engine, with the probe as evidence).

**`effect/ai` for models. Cloudflare for everything under and around it. No AI framework, no LangSmith.**

## What checking the repo corrected

Three claims in `docs/services.md` turned out to be stale, and each was found by reading the code rather than
the doc — worth noting because those files are what `AGENTS.md` tells an agent to read _before_ changing
anything, so being wrong in them is expensive:

- §3.1 "Still not wired: the cron" — `scheduled` exists in `Main.ts`, runs `SweepEnqueueGap`, and
  `triggers.crons` is in `wrangler.jsonc`.
- §9 scores "Agents (tool-calling loop)" as ❌ with _"`toolChoice` is always `none`"_ — `AskCorpus` has a real
  `Tool.make("search_policy")` loop, and now a grounding refusal too.
- §7 "AI Gateway — Not used" — Pulumi creates the gateway with `cacheTtl: 3600` and `collectLogs: true`, the
  vars are set, and the language model applies `{ gateway: { id } }` on the binding transport.

The one genuine AI Gateway gap was narrower and is issue `01`, now done: the embedder bypassed the gateway on
both transports, which is the call the eval harness makes most.

**A fourth stale claim, and this one was mine.** I reported that no gateway existed on the account. It had
existed since 2026-09-29. The cause was reading an inline code comment as a current fact — the same shape as
the three above, which is why `docs/references.md` now carries the gateway as a dated row.

## Order of work

| #  | What                                     | Why now                                                                  |
| -- | ---------------------------------------- | ------------------------------------------------------------------------ |
| 01 | Route embeddings through AI Gateway      | free, and the cache is what unblocks the eval quota                      |
| 02 | Reranker behind a port                   | cheapest model in the catalogue; `evals:retrieval` proves it or does not |
| 03 | Migrate the decide pipeline to Workflows | the property is proven; deletes 298 lines carrying R7                    |
| 04 | Agents SDK slice                         | the capability every advanced-AI engagement asks for                     |
| 05 | Eval-run store                           | the one thing on this stack with no Cloudflare counterpart               |
