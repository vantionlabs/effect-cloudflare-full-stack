# Route embeddings through AI Gateway

Status: **done 2026-09-30**

## The code half is done (2026-09-30)

`EmbedderWorkersAi` was the last adapter calling Workers AI directly. Both transports now route:

- **binding** — `binding.run(model, input, { gateway: { id } })`, matching `LanguageModelWorkersAiBinding`.
  `Main.ts` passes `env.AI_GATEWAY`, which the very next line was already passing to the chat adapter.
- **REST** — a `cf-aig-gateway-id` header on the unchanged `/ai/run/@cf/{model}` URL. Not the gateway
  hostname: Cloudflare documents the header as the way to route a `@cf/` model, and `docs/references.md`
  carries the quote.

Seven assertions in `policy/domain/test/EmbedderWorkersAi.test.ts`, including one that the header is
**omitted** rather than sent empty when no gateway is configured, and one that a routed call still returns
vectors of the column's width — routing is a transport concern and must not change a vector, or the eval
harness's numbers stop meaning anything. Verified to bite: reverting the run option fails exactly one test.

This was the highest-value of the four paths and the last to be fixed, which is the wrong order. The eval
harness embeds the corpus plus 99 questions on every run, so the embedder is the most repeated model call
in the system and its cache is worth the most against a neuron allocation.

## The gateway already existed, and I said otherwise

**Corrected against the account on 2026-09-30.** `effect-ai-ai-dev` was created **2026-09-29 16:18:23** with
exactly the settings `infra/index.ts` declares — `cache_ttl: 3600`, `collect_logs: true`, 600/60s sliding. So
Pulumi had been applied for it, no MCP authorisation was needed to create anything, and this issue's "what
needs a person" section was asking for work that was already done.

How the error happened, because the mechanism matters more than the fact: a comment in
`LanguageModelWorkersAi.ts` said _"no gateway exists on the account yet"_. It was true when written, went
stale silently, and I read it, combined it with "Pulumi is frozen", and reported the conclusion as a finding
rather than as an inference I could not check. `AGENTS.md` names this exact failure — an external fact belongs
in `docs/references.md` with the date it was checked, _"so a stale claim can be told from a wrong one"_. The
comment is corrected and the fact has a dated row.

## Verified by execution

The gateway's logs give a clean before/after for the embedder fix:

- only `@cf/meta/llama-3.3-70b-instruct-fp8-fast` from 14:42 UTC
- `@cf/baai/bge-m3` appears first at 17:00 UTC, after the embedder commit at 16:36 UTC

And the cache does what it was wanted for: cached entries report `cost: 0` and `latency: 0`, where an
uncached `llama-3.3-70b` call at 888 input tokens costs 30.23 neurons. A repeated eval run over identical
fixtures is therefore free.

## What this leaves for `05`

Gateway logs give cost, tokens, latency and cache status — **not the prompt**. `request` and `response` come
back as empty strings and `prompts` is null, because body logging is off. So they are not an eval-run store,
which is what issue `05` is for.
