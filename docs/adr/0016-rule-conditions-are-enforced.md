# ADR-0016 — An auto-approve rule is a bounded authorisation, and rail 3 enforces every bound

**Status:** accepted · **Date:** 2026-09-29

## Context

Rail 3 exists so that automatic approval points at something a human armed deliberately: _a model's own
confidence score is not an authorisation._ It was implemented as a boolean — does an armed rule exist for
this organisation and vertical — while the `rules` table stored `max_amount_minor` and `currency` from its
first migration. **Nothing read those columns.**

That gap was invisible to every test. The decide pipeline's tests all ran with nothing armed, so rail 3
stopped `auto_approve` before anything below it could run, and the auto-approve branch — the architectural
claim the whole design turns on, that the router and the human path call the same `EmitExecute` — had no
test at all. A ceiling that nothing enforces looks exactly like a ceiling.

`bun run evals:rule` put a number on it. It assumes the model proposed `auto_approve` for every invoice in
the labelled set, with a valid citation, an armed rule and hybrid retrieval, and asks what is left:

```
labelled scenario       correct outcome      seen  released  stopped by
over_threshold          route_for_approval     50        50  NOTHING — the rails trust the model here
no_purchase_order       route_for_approval     40        40  NOTHING
unknown_supplier        route_for_approval     30        30  NOTHING
foreign_currency        route_for_approval     20        20  NOTHING
short_payment_terms     route_for_approval     20        20  NOTHING
duplicate_invoice       reject                 20        20  NOTHING
over_board_threshold    route_for_approval     10        10  NOTHING
arithmetic_wrong        reject                 20         0  grounding
illegal_vat_rate        reject                 10         0  grounding
```

**190 of 300 released**, including an invoice for EUR 118,683. The only thing stopping anything was the
pair of model-free checks, and the rule contributed nothing but its own existence.

## Decision

**A rule is a conjunction of bounds, and rail 3 escalates once per bound that does not hold.**

`evaluateRule(rule, facts)` is a pure function returning the **unmet conditions as strings**, not a boolean.
Rail 3 consumes `ruleUnmet: ReadonlyArray<string> | null`, where `null` is "no armed rule" and `[]` is "an
armed rule whose every bound held" — the only state in which `auto_approve` survives. Reasons rather than a
boolean because the reviewer reads them: "above the rule's ceiling of EUR 1.000,00" is actionable and "the
rule did not apply" is not.

Migration 15 adds `require_po`, `approved_suppliers` and `min_payment_days` beside the existing
`max_amount_minor` and `currency`. After the change, 1 of 300 is released.

Three properties that are decisions rather than implementation:

**1. Unreadable is unmet.** An amount `parseMoney` refused, a date pair in an unrecognised format — each
means the bound cannot be _shown_ to hold, and a bound that cannot be shown to hold has not held. The
alternative, skipping a check whose input is missing, is how an invoice with an unparseable total walks
past a ceiling.

**2. The condition set is closed.** No stored predicate DSL, no expression language. A condition set that
can express anything is one nobody can audit, and this is the object that authorises paying a supplier with
no human involved. Adding a condition is a migration and a code change, which is the correct friction.

**3. The rule can only refuse.** It never permits anything the policy does not. This matters for the decide
prompt: the model reports whether policy is _satisfied_, and the rule decides whether that may be acted on
unattended. Conflating the two is why `auto_approve` was reached on 0 of 12 cases before the prompt said so
explicitly — the policy authorises a _person_ ("the budget holder may approve up to EUR 1.000") and never
authorises a machine, so a model told "do not propose auto_approve unless a clause permits it" correctly
declines forever.

## The one thing still ungated, and why it is not a rule condition

`duplicate_invoice` — 1 of 300 gets through, and it is the sharpest case in the set: EUR 559.73, approved
supplier, purchase order present, under the ceiling, clean on every axis the rails can see. The other 19 of
20 duplicates are stopped **only incidentally**, because a duplicate inherits the earlier invoice's supplier
and amount and so tends to breach some other bound. Reading "19/20 stopped" as coverage is exactly backwards.

A duplicate is a property of the **corpus**, not of the invoice in front of you, so no pure rule condition
can decide it — answering needs a query. It belongs with the deterministic checks, and `document_fingerprints`
(plan slice 1: "turns docket's SELECT-then-decide duplicate check into a constraint") is where it goes. It
does not exist yet.

`evals:rule --strict` therefore holds it in a `KNOWN_UNGATED` map that names the mechanism, and the gate is a
**ratchet in both directions**: it fails on any released scenario that is not listed, and it also fails when a
listed scenario turns out to be stopped, because then the entry is stale and deleting it is the point.
Both directions were negative-tested.

## Also changed, because the same measurement exposed it

Rail 1 took a single `grounded` boolean covering both span verification and arithmetic, and its message read
"one or more extracted spans did not verify" — so an invoice whose lines did not add up sent the reviewer to
check provenance. `evals:rule` printed it as "stopped by: grounding" on the arithmetic scenarios, which is how
it was noticed. The rail now takes `unverifiedSpans` and `arithmeticFailures` separately and fires once per
failure, naming the field or the sum.

## Revisit when

- **A customer needs a bound this set cannot express.** Then add a column and a clause in `evaluateRule` —
  not a predicate language. If that happens three times, reconsider, and record what the three were.
- **`document_fingerprints` lands**, at which point the `KNOWN_UNGATED` entry must be deleted and the gate
  will fail until it is.
- **A rule needs to permit rather than only refuse.** It should not. If it ever seems to, the policy corpus
  is being worked around.
