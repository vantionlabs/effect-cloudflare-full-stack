# Feature A — AI chat over the corpus, with no Durable Object

Status: ready-for-agent
Blocked by: 05

A reviewer asks "why does clause 4 apply to this invoice?" and gets a streamed answer with citations from
the same hybrid retrieval the decide pipeline uses.

**This feature must not use a Durable Object, and that is the point of it landing after the two that do.**
One user streaming from a model needs no coordination between clients — the thing a room is for. A room here
would add a hop, a second home for state, and up to 15 minutes of billable duration per exchange, because a
model call is an outbound connection. Build it as a stream from the Worker.

## Shape

- Retrieval through the existing hybrid search function; the answer carries the same `Citation` shape the
  decisions do, so the console can highlight with the same `containsVerbatim` it already uses.
- Transcript in Postgres, scoped as everything else is. A conversation about a decision is audit material.
- `@tanstack/ai` on the client, which is why it is a dependency.
- The scripted `LanguageModel` double works here too, so the whole feature is testable with no API key —
  and `wrangler dev` with no credentials should still demonstrate it.

## Done looks like

- A streamed answer with citations that resolve to real clauses.
- A test proving a citation to a clause that was never retrieved is refused, not rendered — the chat surface
  must not become a way around the grounding rails the decide path enforces.

## Comments

**Mostly built, and the part that is missing is the part that matters.**

Built: `policy/use-cases/Ask/AskCorpus.ts` with `AskRpcLive` as its edge, and five tests including that it
offers exactly one tool and that the tool is read-only, and that the retrieval bound is the one captured at
layer build rather than one the model could influence.

Missing, both bullets of "done looks like":

- **The answer is not streamed.** `AskRpcLive` returns a value; there is no `Stream` in it. For a question
  answered over a corpus this is a user-visible difference, not an implementation detail.
- **There is no test that a citation to a clause which was never retrieved is refused rather than rendered.**
  This is the one that should block: the decide path enforces grounding through rails, and a chat surface that
  renders an ungrounded citation is a way around them. `VerifySpans` and `containsVerbatim` already exist to
  be reused, so this is a test plus a refusal, not new machinery.
