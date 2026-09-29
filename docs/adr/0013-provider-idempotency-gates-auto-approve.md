# ADR-0013 — An adapter without provider-side idempotency may not be enabled with auto-approve armed

**Status:** accepted · **Date:** 2026-09-29 · **This is a product rule, not an engineering preference.**

## Context

`ExecuteDecision` claims, calls the adapter, then records the result. Between the call returning and the
status write landing, the isolate can be evicted. The call happened; no record of it exists.

**No transaction can close this.** The outbound call is in someone else's system, and Postgres cannot
participate in it. The window is small and it is real, and on this product's subject matter its consequence
is paying a supplier twice.

Three mitigations exist, and only the first actually removes the failure:

1. **The provider's own dedupe key.** `AdapterRequest.idempotencyKey` is sent as the target system's
   idempotency key, so a replay after a lost completion is a no-op _at the provider_. The duplicate cannot
   happen, rather than being detected afterwards.
2. **Never auto-retry an ambiguous `pending`.** It becomes `needs_attention`, the decision follows, and a
   human resolves it. This prevents _us_ from causing the double, but does nothing about one already caused.
3. **A cron reports stuck claims and must not resolve them.** Reporting is safe; resolving requires knowing
   what happened, which is what (1) and `lookup` are for.

(2) and (3) are containment. Only (1) is a fix.

## Decision

**An `Adapter` whose `providerIdempotent` is false may not be enabled for an organization with an armed
auto-approve rule.**

The reasoning is about who is present when it goes wrong. With a human in the loop, a duplicate payment has
a person attached to it who remembers approving, can be asked, and can act within minutes. With auto-approve
armed there is nobody: the decision was made, executed and duplicated with no human in the path, and the
first anyone knows is a supplier's statement.

The asymmetry is what makes this a product rule. The same technical risk is acceptable in one configuration
and not in the other, so it cannot be settled by making the code better.

### How it is expressed

- `AdapterService.providerIdempotent` is **required**, not optional, so a new adapter must state its answer
  rather than omit it.
- `AdapterService.lookup` is optional, and its absence is the second signal: an adapter that cannot be asked
  what happened cannot be reconciled, only escalated.
- `AdapterRequest.idempotencyKey` exists from the first commit even though `DryRunAdapter` ignores it.
  Retrofitting it would mean auditing every adapter written before — and the audit would be of code whose
  authors never had to think about this.

**Not yet enforced in code.** Today nothing is armed and the only adapter is the dry run, so there is nothing
to enforce against. The check belongs where a rule is armed — `rules.armed` flipping to true should fail if
the organization's configured adapter is not provider-idempotent. That is written down here rather than left
implicit, because the moment a real adapter lands is the moment it stops being hypothetical.

## Consequences

An adapter for a target system without idempotency keys is still usable — for the human path only. That is a
genuine product limitation to state to a client rather than engineer around: "we can automate this once your
ledger supports idempotency keys" is an honest sentence, and "we automated it anyway" is how a supplier gets
paid twice.

## Revisit when

A target system offers a weaker guarantee that is nonetheless sufficient — a natural unique key on the
document, say, that makes a duplicate impossible for a different reason. The rule is about the _outcome_
being impossible, not about the mechanism being named idempotency.
