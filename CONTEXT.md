# CONTEXT

The vocabulary of this domain, as the code uses it. `docs/agents/domain.md` asks that output naming a
domain concept use the term defined here rather than a synonym, so this file is a constraint on writing and
not only a reference.

What this is **not**: an overview. That is [`docs/README.md`](docs/README.md), and the reasoning behind the
architecture is [`docs/PLAN.md`](docs/PLAN.md) and [`docs/adr/`](docs/adr/). This file answers "what is that
thing called, and what exactly does it mean here".

Every closed set below is closed **in the code**, and the file path is given so a reader can check rather
than trust. A path with no package prefix is relative to `packages/modules/src/`. When a term's definition and the code disagree, the code is right and this file is stale.

---

## The product, in one paragraph

An **organization** uploads a **document**. The system **extracts** fields from it with a **source span** for
each, **retrieves** the applicable **policy** clauses, and proposes a **decision** with **citations**. Four
**rails** then run, and may only move that decision _toward_ a human. What survives is either
**auto-approved** and **executed**, or it waits in the **review queue** for a person. The product's claim is
the refusal: it knows when it is not allowed to decide, says why, and every automatic decision carries
something somebody can audit a year later.

---

## Tenancy and identity

**Organization** — the tenant, and the unit everything is scoped by. Never called an account, a workspace, a
team or a customer. One organization is created per user at signup, because a session that cannot name its
tenant is not served.

**Member** — a user's participation in one organization, carrying a **role**.

**Role** — closed: `owner`, `reviewer`, `viewer`
(`packages/modules/src/iam/…`, `packages/domain/src/Identity/Identity.ts`). **`admin` is not a role here**,
though better-auth's own vocabulary has one — authorising on a string nobody defined is the failure this
closed set exists to prevent, and a test asserts `admin` is refused.

**Identity** — who is acting and in which organization: `userId`, `orgId`, `email`, `role`.

**`CurrentUser` / `CurrentOrg`** — the two tenancy tags, and **they are not interchangeable**. `CurrentUser`
means _which person_ (recording `approved_by`, reading "my" queue); `CurrentOrg` means _which tenant_, which
is almost everything. `CurrentUser` implies `CurrentOrg` and never the reverse, so background work — a queue
consumer, a cron — can satisfy `CurrentOrg` and can never accidentally satisfy `CurrentUser`. Say "the
tenant" for the second, not "the user".

---

## Intake and documents

**Intake** — one arrival of one document: the record that something was submitted, distinct from the
document itself. Carries an **external ref**, unique _per organization_.

**Source document** — the bytes in R2 plus the row describing them. "Document" alone means this.

**Collection** — closed: `policy`, `transactional` (`shared/domain/Corpus/Collection.ts`).
Which corpus a document belongs to. Policy is the rules; transactional is the things being decided about.
The retrieval function filters on it, so this is not a label — it is what keeps an invoice from being cited
as if it were a clause.

**Parser tier** — native text, WASM (`anydoc`), or OCR. A **parser version defines the verbatim contract**:
its markdown output is what a source span is checked against, so a parser bump changes grounding silently.

**`UnsupportedDocument`** — the typed refusal, naming what _is_ supported. A refusal is a feature here, never
a best-effort parse.

---

## Extraction and provenance

**Extracted field** — a value _with_ its evidence: `{ value, source_span, page }`. A value without a span is
not an extraction.

**Source span** — the excerpt from the document that a value was read from, quoted exactly.

**Verbatim** — the property that an excerpt occurs in its source under whitespace-normalised, case-folded
comparison and nothing else (`shared/domain/Verbatim/Verbatim.ts`). Punctuation, digits and currency symbols
must match, because those are the things worth lying about. `containsVerbatim` is shared with the browser so
the reviewer's highlight cannot disagree with the rail that checked it.

**Grounding** — whether every span in a decision is verbatim. "Grounded" is a property of a decision, not of
a model.

**Money** — integer **minor units** in an integer column, never a float, and `Cents` is the brand. An amount
is extracted as a **string** first — the digits as printed, which is also what the span quotes — and parsing
it **fails** on ambiguity rather than guessing, because an amount we cannot read exactly is not one we should
decide on.

---

## Retrieval

**Chunk** — a passage of a policy document, indexed with an embedding and a `tsvector`, carrying a
**clause ref** and an **in force** flag.

**Hybrid retrieval** — semantic and lexical search fused by **RRF** in one SQL function, so the two halves
cannot disagree and there is no partial-failure mode.

**Retrieval mode** — closed: `hybrid`, `lexical`, `semantic`, `none`
(`shared/domain/Retrieval/Retrieval.ts`). **Recorded on the decision**, because a decision made on degraded
retrieval is not the same decision. Anything but `hybrid` blocks auto-approval (rail 4).

**Degraded** — any mode other than `hybrid`. Prefer this word to "fallback": the point is that the decision
is weaker, not that a code path was substituted.

---

## Decisions

**Decision** — a proposed **outcome** with **citations** and a rationale, after the rails.

**Outcome** — closed: `auto_approve`, `route_for_approval`, `reject`, `needs_human`
(`decision/domain/Decision/Decision.ts`). `reject` is a decision we are prepared to defend;
**`needs_human` is an admission that we are not**, and the two are not interchangeable however similar the
queue makes them look.

**Severity** — how far an outcome is from being automatic: `auto_approve` 0, `route_for_approval` 1,
`reject` and `needs_human` 2. Exists so the rails' central property is _statable_ and property-tested.

**Status** — closed: `pending_review`, `approved`, `rejected`, `auto_approved`, `needs_attention`. There is
deliberately **no `executed` status**: execution state lives on the execution and is joined, because a
decision and the act it authorised have different lifetimes.

**Effective outcome** — `coalesce(override_outcome, outcome)`, generated in the database so a caller cannot
read `outcome` as final by accident.

**Citation** — a chunk id, an excerpt, and optionally a clause ref. A citation to a chunk that was never
retrieved for _this_ decision is refused (rail 2), because a true statement found elsewhere in policy is
still not support for the clause being cited.

---

## Rails

**Rail** — a check that may only move a decision toward a human. Never "validation" and never "guardrail":
the directional property is the whole point, and it is property-tested as
`severity(output) >= severity(proposal)`.

**Railed decision** — a decision that has passed the rails, carried as an unconstructible brand. The store
accepts **only** this type, so writing a decision that skipped the rails is a compile error. This is why
rails are a function and not a service: "the rails, but disabled" must not be expressible.

The four, named by the prefix each uses when it fires (`decision/domain/Decision/Rails.ts`):

| Prefix        | Fires when                                                       | Moves to             |
| ------------- | ---------------------------------------------------------------- | -------------------- |
| `grounding:`  | a span does not occur in the document                            | `needs_human`        |
| `citation:`   | a cited chunk was never retrieved, or an excerpt is not verbatim | `needs_human`        |
| `arithmetic:` | the totals or the VAT do not add up                              | `needs_human`        |
| `authority:`  | `auto_approve` with no **armed** rule, or a bound unmet          | `route_for_approval` |
| `retrieval:`  | `auto_approve` on anything but `hybrid`                          | `route_for_approval` |

**Rails fired** — the list recorded on the decision. A rail names itself in the reviewer's words, not in
code terms: reporting a supplier's own bad sum as "grounding" sent reviewers looking for the wrong thing.

**Armed** — of an auto-approve **rule**: stored, explicit, and switched on by a person. **A model's own
confidence is not an authorisation**, and at most one rule may be armed per organization per vertical.

---

## The human boundary and execution

**Review queue** — the decisions waiting for a person, read in arrival order (which is free, because ids are
time-ordered).

**Approve** — a compare-and-swap against the decision row, recording `approved_by`. Two tabs approving
produce **one** event and one execution.

**Execution** — the record of acting on an approved decision, claimed by an **idempotency key** with
`on conflict do nothing … returning id`. Zero rows means somebody else owns it.

**Idempotency key** — **derived, never generated**: `decision:<decisionId>:<action>`, used for both the event
row and the execution row so a retry at either layer lands on the same key.

**Adapter** — the thing that actually acts on the outside world. An adapter without provider-side
idempotency may not be enabled for an organization with auto-approve armed; that is a product rule.

**`needs_attention`** — where an _ambiguous_ execution goes. An ambiguous claim is never auto-retried,
because the unclosable window is "the call succeeded and the recording write was lost", and retrying it can
pay a supplier twice.

---

## Events and workflows

**Event** — a durable row that is also the audit trail, plus a tiny queue message (`{ eventId, type }`) so a
redelivery reads _current_ state.

**Event type** — closed: `document.decide`, `decision.execute` (`shared/domain/Event/Event.ts`).

**Terminal** vs **retryable** — a terminal failure fails identically on retry, so it is acked and recorded
rather than retried. `shared/domain/Errors/Terminal.ts` names other slices' tags as strings on purpose.

**Enqueue gap** — the window between writing an event row and the queue accepting it, which no transaction
spans. A `queued` row older than two minutes is the recovery record, and a cron re-sends it.

**Workflow** / **Activity** — a pipeline and its memoised steps. A completed activity replays from its
stored exit, which is why a transient judge failure does not re-pay for extraction. **The human pause is a
database row, never a suspended execution.**

---

## Chat and realtime

**Room** — the unit of fan-out. Closed **kind**: `channel`, `decision`
(`chat/domain/Room/Room.ts`) — a durable channel per organization, or the thread attached to one decision.

**Channel** — a room of kind `channel`, named and slugged, archivable rather than deletable.

**Message** — a body up to 4000 characters, with **mentions** and **reactions**, editable and soft-deletable.

**Presence** / **Viewer** — who is connected and what they are looking at. **Derived from socket
attachments every time, never cached**, so a ghost is not representable. Deliberately not durable.

**Frame** — a Schema-encoded message on the socket. The transport carries an **opaque payload** and each
slice owns its own frames, so the room has no idea what a `QueueChanged` is.

**Room identity** — the authenticated identity handed to a room at the upgrade, checked **once**. A socket is
retired after thirty minutes so revocation eventually bites.

---

## Words this project avoids

| Avoid                           | Because                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| "user" for the tenant           | `CurrentUser` and `CurrentOrg` are different tags with different reach. Say "organization" or "the tenant".        |
| "admin"                         | not in the closed role set; `owner` is the term                                                                    |
| "validation" for a rail         | loses the directional property that is the rails' entire claim                                                     |
| "confidence"                    | a model's confidence is never an authorisation. Say "armed rule" or "bound".                                       |
| "vector store"                  | there is one store. The vector and the citable text cannot diverge, which is the point of ADR-0004.                |
| "executed" as a decision status | execution lives on the execution row; the two have different lifetimes                                             |
| "fallback" for retrieval        | say **degraded**: the decision is weaker, not merely the code path                                                 |
| "channel" for a decision thread | a thread is a room of kind `decision`; channels are the durable, named ones                                        |
| "session" for a socket          | a socket carries an identity resolved once; a session is better-auth's, and re-reading one is not what a room does |
