# An eval-run store — the one thing on this stack with no counterpart

Status: ready-for-agent

ADR-0023 rejects LangSmith on two grounds (Enterprise-only self-hosting; a SaaS receiving clients'
documents fails the residency rule ADR-0006 applied to OpenRouter). AI Gateway covers the logging and cost
half. **Datasets, experiments and quality trends have no Cloudflare counterpart**, so they are ours.

Today `bun run evals` prints numbers to a terminal and they are gone. The baseline it scores against —
docket's 33/99 grounded, 7/99 matched — lives in a comment.

## Acceptance

- Tables for a run, its cases and its scores, on the Postgres already there. A run records the **model,
  the embedding model, the parser version, the retrieval mode and the prompt field order** — every one of
  those changes the number, and ADR-0008's whole point is that one of them is an unmeasured hypothesis.
- `evals:retrieval` and `evals` write a run instead of only printing one.
- A trend query: per-client recall and grounding over time.
- **The alarm from plan risk R1: a FALLING `needsHumanRate` is not a win.** Whatever displays this must
  make that impossible to misread, because weaker grounding improves the headline number while shipping
  ungrounded decisions.

`effect/ai`'s `Telemetry` module already emits `gen_ai.*` spans into the OTLP drain, so traces are handled
and not in scope. What is missing is the dataset concept — a named set of cases you can re-run and compare.
