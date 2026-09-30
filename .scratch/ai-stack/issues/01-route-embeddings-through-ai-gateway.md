# Create the AI Gateway — the code routes through one that does not exist

Status: ready-for-human

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

## What needs a person

**No gateway named `effect-ai-ai-dev` exists on the account**, and every adapter and every level of
`wrangler.jsonc` names it. `infra/index.ts` declares it with `cacheTtl: 3600`, `collectLogs: true` and a
600/min sliding rate limit — and Pulumi has never been applied, and is now frozen (ADR-0007 status note).

`wrangler` has no `ai-gateway` command, so this is the `cf-ai-gateway` MCP server, which needs one
authorisation in a browser:

```
https://ai-gateway.mcp.cloudflare.com/oauth/authorize?...   (regenerate with the authenticate tool;
                                                             the URL carries a one-time PKCE challenge)
```

Once authorised, create a gateway with id `effect-ai-ai-dev` and the settings `infra/index.ts` declares.
**Do not accept the defaults** — an auto-created gateway has no cache, and the cache is the entire reason
for wanting it.

### Why `default` is not the answer here

Cloudflare accepts the literal id `default` and creates a gateway on first authenticated request, which
makes "no gateway exists" a non-blocker in general. It is rejected for this repo because the auto-created
gateway would not carry `cacheTtl: 3600`, and the eval quota is the problem being solved.

### The check this got past

`scripts/bindings-check.ts` compares `wrangler.jsonc` against `Bindings.ts`, and both agreed. ADR-0007's
"Revisit when" already named this as its blind spot, as a hypothetical; it is the real state. Worth
considering whether the check can be taught to ask the account, which would need a token — the same token
that is missing for everything else.
