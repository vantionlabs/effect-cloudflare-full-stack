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
