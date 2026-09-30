# ADR-0025 — An agent owns interaction; Workflows own execution; the Worker owns the database

**Status:** accepted · **Date:** 2026-09-30 · **Extends** [ADR-0019](0019-no-database-in-a-durable-object.md),
**bounded by** [ADR-0023](0023-the-ai-stack.md) and [ADR-0024](0024-workflows-replace-the-hand-rolled-engine.md)

## Context

`AskCorpus` is a real tool-calling loop with a grounding refusal, and it is stateless: one question, one
answer, nothing remembered. Everything asked for beyond that is state — a conversation that persists, an
agent that waits for a person, a stream a reviewer can reconnect to. The Agents SDK is Cloudflare's answer,
and adopting it raises a third execution model in a repo that just accepted a second (ADR-0024), so
ADR-0023's rule 2 applies: **a new execution model needs a written trigger and a boundary rule.**

The trigger is real — a conversation cannot be expressed by either the queue or a Workflow, because neither
is interactive. The boundary is this ADR.

## Decision

**Three owners, and the split is Cloudflare's own:** _"Agents excel at real-time communication and state
management. Workflows excel at durable execution."_

| Concern                                             | Owner          | Why not the others                                                                                       |
| --------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| Interactive conversation state, resumable streaming | **the agent**  | a Workflow is not interactive; a Postgres row cannot resume a stream                                     |
| Waiting on a human, retrying, multi-step durability | **Workflows**  | ADR-0024's rule assigns waiting to `waitForEvent`; an agent's `schedule()` would be a second way to wait |
| Anything auditable, and every database touch        | **the Worker** | ADR-0019, and the tenancy argument below                                                                 |

### The agent does not call `schedule()`, and that is a consequence of our own rule

An approval chased in 48 hours looks like the Agents SDK's showcase feature, and it is **not the agent's job
here**, because ADR-0024 already decided that waiting on a human or an external event is `waitForEvent`.
Having both would mean two mechanisms for one concern, drifting independently — and the tracker issue for
this work said `schedule()` was the win, which contradicted ADR-0024 two files away. Corrected in place
rather than quietly, because that is the kind of mistake the boundary rule exists to catch.

What remains genuinely the agent's is what neither of the others can do: interaction.

### The agent never touches the database, and for an agent cost is the weaker reason

ADR-0019 forbade a database client in a Durable Object on cost: an outbound `connect()` keeps the object
resident and billable for up to 15 minutes. **That argument is weaker for an agent**, and saying so is the
point — an agent that streams from a model holds an outbound connection anyway, and the 15-minute rule
exists precisely so a model stream is not cut off mid-answer. Residency is something an agent accepts by
nature. If cost were the only reason, this would be arguable.

**The reason that settles it is tenancy.** ADR-0019 records that _"a Durable Object cannot validate the
identity it is handed"_. The corpus is tenant-scoped, and `Db.scoped` requires `CurrentOrg`, which the
Worker resolves from a session. An agent querying the corpus itself would query on behalf of an identity it
cannot check — in the one place the tenancy seam is not a compile error. So `dep:check`'s rule is extended
from `apps/worker/src/Room*` to agents, with both reasons recorded, and verified to bite.

The shape is therefore the two hops a room already uses: client → Worker → Postgres, then Worker → agent.
The Worker runs `AskCorpus`; the agent is handed the turn.

### `Agent`, never `AIChatAgent`

`AIChatAgent` requires the **Vercel AI SDK** — `ai@^6||^7` and `@ai-sdk/react` are peer dependencies of that
entry point. Adopting it means a second model abstraction beside `effect/ai`, which is exactly what ADR-0023
decided against, in exchange for a chat loop we already have and whose grounding refusal the AI SDK knows
nothing about.

Checked rather than assumed, by installing `agents@0.24.0` and reading its manifest: `ai`, `react`, `zod`
and the MCP SDKs are **all peer**, so the plain `Agent` class is reachable without any of them. That is what
makes this adoption cheap — the SDK's state, storage and scheduling primitives without its model layer.

### A conversation is a convenience copy, not evidence

The agent's state holds turns; **Postgres holds the answers.** Deleting the namespace would lose no citation
and no decision. That is what makes it acceptable to keep state somewhere with no `select` — and it is why
the turn limit (`MAX_TURNS = 50`) is safe: dropping an old turn drops a copy.

Stated as a rule because the opposite is tempting and would be a real regression: an auditable fact that
existed _only_ in a Durable Object would break the product's central claim, which is that every automatic
decision can be re-examined a year later.

## Consequences

- **A conversation id must carry an organization component.** One name is one instance and it never moves
  (ADR-0018), so isolation is by name and by nothing else. The agent cannot defend itself, so the Worker
  composing the name is the only thing between two tenants. Noted on the binding, where it is read.
- **No decorators**, so no `@callable()` RPC for now. The SDK's decorator support runs through a Babel
  plugin applied by a Rolldown or Vite plugin, and this Worker is bundled by wrangler. `onRequest` costs
  nothing by comparison. Worth recording that `erasableSyntaxOnly` is **not** the obstacle — a decorated
  method compiles under it, which was verified rather than assumed.
- **`storage: "sqlite"` is mandatory** for the namespace: the SDK keeps state and its schedule table in SQL
  storage. It is also the only backend a new namespace may declare.
- **An agent is resident while it streams, and that is duration billing.** Unlike rooms, which were designed
  to hibernate, this namespace costs wall-clock time. That is the price of interaction and should be watched
  per client rather than discovered.
- **The class lives in `apps/worker`** because a Durable Object class must be exported from the entry and
  declared in `exports`; its behaviour lives in `policy/domain/Assistant`, tested with no `workerd`.

## Revisit when

- **`@callable()` becomes worth a bundler change**, or wrangler gains decorator support without one. Then the
  RPC surface replaces `onRequest` and the client SDK's hooks become available.
- **A second thing needs to wait.** If Workflows' `waitForEvent` turns out not to fit an interactive pause,
  this ADR's split is the thing that was wrong, and the fix is to move the boundary deliberately rather than
  to add `schedule()` beside it.
- **`effect/ai` grows a stateful session abstraction** beyond `Chat`. Then rule 1 of ADR-0023 applies and the
  agent's state may belong behind it.
- **The conversation becomes something a client asks to keep.** The moment a reviewer's history is a
  contractual record rather than a convenience, it moves to Postgres and the agent keeps only the live turn.
