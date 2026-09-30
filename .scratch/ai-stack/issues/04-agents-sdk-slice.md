# A stateful agent on the Agents SDK

Status: ready-for-agent

`AskCorpus` is a real tool-calling loop and it is **stateless**: one question, one answer, refuse if the
citation cannot be verified. Everything a client asks for beyond that is state — a conversation that
remembers, an agent that schedules its own follow-up, one that waits for a person and resumes.

That is the Agents SDK's job, and Cloudflare draws the line itself: _"Agents excel at real-time
communication and state management. Workflows excel at durable execution."_ So this is additive to issue
`03`, not an alternative.

## What it gives that we do not have

| Capability                                 | Why it matters here                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Per-agent SQLite state in a Durable Object | a conversation with a reviewer, durable across requests                     |
| `schedule()`                               | "chase this approval in 48 hours" without a cron that scans every row       |
| Human-in-the-loop                          | the agent pauses for a decision and resumes with it                         |
| Resumable streaming                        | a reviewer closing a laptop mid-answer does not lose the answer             |
| `McpAgent`                                 | our corpus as an MCP server, which `effect/ai`'s `McpServer` also addresses |

## The one thing to be honest about

**`runFiber`/`startFiber`/`stash` are not automatic replay.** The Agents SDK does not memoise a step the
way Workflows does — that was checked, and it is why `03` and this issue are both open rather than one
replacing the other. Durable execution is Workflows'; state and scheduling are the Agents SDK's.

## Status: started 2026-09-30

Landed, and deliberately the thin end:

- `policy/domain/Assistant` — the turn and conversation schemas, `appendTurn`, `MAX_TURNS = 50`. Pure, 7
  tests, no platform.
- `apps/worker/src/AssistantAgent.ts` — the `Agent` subclass. Glue only: state contract,
  `validateStateChange` decoding through the domain schema, and `onRequest`.
- Binding `ASSISTANTS` in every environment with `storage: "sqlite"`; `bindings:check` reconciles it.
- `dep:check`'s no-database rule extended from rooms to agents, with the tenancy reason, verified to bite.
- 6 tests in real `workerd` against the real class through a fixture Worker: state survives a request, two
  names are two conversations, a refusal is recorded with no answer, an invalid turn is refused 400 and not
  appended.
- ADR-0025 records the boundary.

**The Worker edge landed the same day**, so the agent is now reachable:

- `AssistantConversations` — the port. **Every method requires `CurrentOrg`**, which is the design: the
  adapter composes the Durable Object name from a tenant it was given rather than one a caller chose, so a
  handler that forgot the tenant does not compile. `ConversationId` separately forbids the name separator,
  so a client-chosen id cannot close its own segment and address another organization.
- `AssistantConversationsAgent` — the adapter, in `policy/server` because it takes its binding as a
  parameter. `Bindings.ts` now takes its TYPE from the adapter, the same direction as `ROOMS`.
- `AskInConversation` — answer first, record second. **A refusal is recorded and then re-raised**, which is
  the subtle half: returning it as a turn would compile, read well, and turn the product's refusal into a
  successful-looking answer with nothing in it.
- `AssistantRpcs` + `AssistantRpcLive` — RPC only, and the error is a UNION, because
  `ConversationUnavailable` (retry) and `UngroundedAnswer` (the product working) must not be confused by a
  console.

**Still to do, in order:** resumable streaming, then the console surface. Note that `Assistant.ask` is
non-streaming by design for now — `AskProgress` streams the _searching_ and never the prose, because a
citation is only checkable once the answer is complete.

Findings worth keeping:

- The scripted model had to **search before answering**, or every grounded case was refused with "chunk c1
  was never returned by a search for this question". That is `ungroundedCitations` working exactly as
  designed — a citation must have been served _for this question_ — so a model citing without searching is
  ungrounded by definition. The rail caught the test, not the reverse.
- `Schema.pattern` does not exist in rc.118. It is `Schema.String.check(Schema.isPattern(...)).annotate(...)`,
  found by listing the installed module's exports.

## Constraints from this codebase

- **ADR-0019: no database in a Durable Object.** An agent's own SQLite state is fine — that is the DO's
  private storage, not a Hyperdrive connection. Anything needing the corpus calls out through a port.
- **The rails apply.** An agent that answers from the corpus must refuse an unverifiable citation, exactly
  as `AskCorpus` does. Reuse `ungroundedCitations`; do not re-derive the check, or the two will diverge and
  the agent will be the lenient one.
- **`apps/worker` holds a `DurableObject` subclass** because it must be exported from the entry and
  declared in `exports` — so the class is glue and lives there, and the agent's behaviour lives in a slice.
  `RoomDurableObject.ts` is the precedent.
- Tenancy: the agent's name must not be user-controlled without an organization component, or one tenant
  addresses another's agent. ADR-0018's "one name is one instance" is the relevant fact.

Start with the reviewer's conversation over the policy corpus, because it is the one with a real user and
it reuses `AskCorpus` wholesale.
