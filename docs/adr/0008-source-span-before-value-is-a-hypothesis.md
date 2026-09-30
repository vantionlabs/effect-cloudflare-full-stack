# ADR-0008 — `source_span` before `value` is a hypothesis, and it is still unmeasured

**Status:** accepted as a hypothesis · **Date:** 2026-09-30

## Context

Two field orders in this codebase are chosen to change what a model produces, not to read nicely. A model
generating JSON emits keys in schema order, so declaring a field earlier means the model must commit to it
before it can write what follows.

**One of the two is measured.** In `ProposedDecision`, `citations` is declared before `rationale`
(`decision/domain/Decision/Decision.ts`). The other order accounted for **25 of 66 grounding failures on a
99-case run** in the predecessor project: the model writes `[7]` mid-paragraph and only afterwards works out
what citation 7 was. That is a measurement, and the field order is load-bearing because of it.

**The other is not.** In `ExtractedField`, `source_span` is declared before `value`
(`decision/domain/Extraction/Extraction.ts`), on the same reasoning: quote the document first, then say what
you read from it, so the value is derived from the quote rather than the quote being rationalised after the
value. Plausible, symmetrical with the measured case, and **not tested**.

## Decision

**Keep the order, and record that its justification is an analogy rather than a result.** The comment in the
file says so; this ADR is the thing that makes it an open question with a name instead of a convention that
hardens by repetition.

**The measurement is the eval harness's first A/B**: the same fixture set, two schemas differing only in the
order of those two keys, scored on grounded rate. The number to beat is the predecessor's recorded baseline of
**33/99 grounded, 7/99 matched**, which `bun run evals` prints as its first line.

## Why it is still unmeasured

Not an oversight, and worth stating plainly so it is not mistaken for one: the retrieval and decide evals need
real embedding calls, and the Workers AI account has no neurons — `bun run evals:retrieval` is a separate
command for exactly this reason, and CI gates it on `CLOUDFLARE_AI_TOKEN` with a loud warning when skipped. So
the harness cannot complete a scored run today. The A/B is blocked on account state, not on code.

## What would make this a wrong decision

Either result is useful and one of them is embarrassing:

- **No difference.** Then the order is noise, the comment should say so, and one fewer thing is believed for
  aesthetic reasons.
- **The reverse is better.** Possible, and the mechanism is not absurd: a model asked for a span before it has
  settled on a value may quote defensively — a long span likely to contain whatever it later decides — and a
  wider span passes `containsVerbatim` more easily while being worse provenance. **That failure would look
  like success on the grounded rate**, so the A/B must also report span length, or it can be fooled in exactly
  the direction that matters.

## Revisit when

- **`bun run evals` can complete a scored run.** Then run the A/B, record the number here, and change the
  status to accepted-or-reversed with the measurement attached.
- **The parser tier changes.** A span is checked against the parser's markdown output, so a parser bump changes
  what "verbatim" means and invalidates an earlier measurement (this is R6).
- **A model is swapped.** Field-order effects are a property of a model's decoding, not of JSON, so the result
  does not automatically transfer.
