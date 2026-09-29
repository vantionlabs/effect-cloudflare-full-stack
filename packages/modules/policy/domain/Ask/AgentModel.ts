/**
 * The agent's language model, as a **distinct tag** from the decide pipeline's.
 *
 * Two tags because they are two things, exactly as `CurrentUser` and `CurrentOrg` are:
 *
 *   `LanguageModel`  the decide pipeline's. Structured output only, never tools, and in the Worker it is the
 *                    Workers AI **binding** — no token, no egress, the binding is the authorisation.
 *   `AgentModel`     the agent's. Must support **tool calling**, which means the OpenAI-compatible surface
 *                    and `@effect/ai-openai`'s maintained implementation of that protocol.
 *
 * ## Why not simply provide a different `LanguageModel`
 *
 * Because it would not work and would fail quietly. Effect services are keyed by tag, so two
 * `LanguageModel` layers in one graph means the last one wins — and the loser is whichever path happens to be
 * composed first. The decide pipeline would silently start making HTTP calls with a token, or the agent would
 * silently lose its tools and answer from nothing. Neither errors.
 *
 * A second tag makes the requirement explicit: `AskCorpus` says it needs a tool-capable model, and a
 * composition root that provided only the binding would not compile.
 *
 * ## Why this is in `domain` and not `server`
 *
 * It is a **port**, not an adapter. `dep:check` enforces that only the composition root may name an adapter,
 * and it caught the first version of this: the RPC handler imported `shared/server/Model` directly, which
 * would have bound the api package to a platform and made the fakes-only test tier impossible. The rule was
 * right, and the fix is this tag.
 */
import { Context } from "effect"
import type { LanguageModel } from "effect/ai"

export class AgentModel extends Context.Service<AgentModel, LanguageModel.LanguageModel>()(
  "policy/AgentModel"
) {}
