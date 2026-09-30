# ADR-0023 — The AI stack: `effect/ai` over Cloudflare, and no AI framework

**Status:** accepted · **Date:** 2026-09-30

## Context

The question was put directly: LangChain, LangGraph and LangSmith are open source and appealing, splitting AI
features across several technologies is bad, and this repo is an opinionated boilerplate for advanced client
work rather than one product. So: what is the one stack?

Three facts settled it, and two of them corrected an earlier answer in the same conversation.

**`effect/ai` is more than `langchain-core`.** Reading the module list rather than recalling it:
`LanguageModel`, `EmbeddingModel`, `Tool`, `Toolkit`, `Prompt`, plus **`Chat`** (stateful sessions with
exportable history), **`Tokenizer`** (counting and truncation), **`Telemetry`** (OpenTelemetry `gen_ai.*`
attributes), **`McpServer`/`McpProtocol`**, and **`Decision`/`DecisionModel`** — named classification, rating
and probability decisions answered in one provider call, which is the primitive people add a LangChain package
to get. Verified absent: reranking, retrievers, vector stores, loaders, splitters, semantic cache, batch.

**LangSmith cannot join this stack.** Self-hosting is _"an add-on to the Enterprise Plan"_ requiring a license
key, Kubernetes, Postgres, Redis **and** ClickHouse — it cannot run on Workers in any configuration. And the
SaaS receives prompts, retrieved clauses and clients' documents, which fails the residency rule ADR-0006
applied to OpenRouter. **A tracing tool is not exempt from the rule the model provider had to obey.** That is
not a feature comparison; it is the same rule applied consistently.

**Cloudflare has a counterpart to everything else.** Workers AI for models, AutoRAG for managed RAG, Vectorize
for vectors, Browser Rendering for loaders, **Agents SDK + Workflows for LangGraph's job** — Cloudflare states
the split itself: _"Agents excel at real-time communication and state management. Workflows excel at durable
execution."_ AI Gateway covers LangSmith's logging and cost half. The only gap is datasets, experiments and
eval trends.

## Decision

**`effect/ai` is the model layer. Cloudflare is everything under and around it. No AI framework.**

LangChain stays at exactly one import — `RecursiveCharacterTextSplitter` — and it is there **to lose an eval**:
it is measured against the heading-aware chunker on gold-labelled queries, and its own adapter docstring records
that it produces no `clause_ref` and duplicates text across chunk ids, so "cite chunk X" stops being a stable
reference. That is a competitor in a benchmark, not a dependency.

### The four rules, which are the actually opinionated part

1. **Under a port → adopt freely.** Providers, rerankers, gateways, parsers. No architectural cost, and
   `evals:retrieval` decides whether it helped.
2. **A new execution model → only with a written trigger and a boundary rule.** Two are justified (ADR-0024);
   a third needs an argument.
3. **Never let a vendor own the provenance chain.** Retrieval, chunk identity and the verbatim check _are_ the
   product. This single rule rejects AutoRAG, Vectorize-as-primary and every managed RAG service, consistently,
   without relitigating each one: rail 2 needs `containsVerbatim` against the exact stored chunk text, and a
   managed pipeline does not hand you that as a stable citable unit. It also has no local emulator, so
   `evals:retrieval` — the only reason retrieval quality is a known number — could not run.
4. **Data residency applies to tooling, not only to models.** Which is what removes LangSmith.

### Why not LangChain, stated without ideology

The typed error channel and requirements channel are what make the tenancy seam a **compile error**
(`Db.scoped` requires `CurrentOrg`) and the rails unconstructible without passing them. A dict-state graph
runtime converts both into runtime conventions. For one product that is a trade; for a boilerplate carrying
several clients' data it is the differentiator. There is also direct evidence of the cost of adopting a
framework's abstraction over a port: `@langchain/cloudflare`'s embeddings wrapper was rejected because it takes
`binding: Ai` with no REST option, which would have left the recall gate unable to measure the semantic half.

## Consequences

- **The eval-run store is ours to build**, because it is the one thing with no counterpart. Datasets,
  experiments and quality trends per client, on our own Postgres. Tracked in `.scratch/ai-stack`.
- **`effect/ai`'s `Telemetry` module already emits `gen_ai.*` spans**, so agent tracing is standards-based and
  lands in the OTLP drain without LangSmith. What is missing is the dataset concept, not the traces.
- **Portability is given up knowingly.** LangGraph runs on Node and on Workers (through Hyperdrive, since its
  Postgres checkpointer needs raw TCP otherwise); Workflows and the Agents SDK do not. `PLAN.md` already books
  "Workers cannot be self-hosted" as an accepted liability, and `domain/` and `use-cases/` stay portable behind
  ports regardless — so this pays a real architectural cost for a liability already accepted.

## Revisit when

- **A client requires deployment off Cloudflare.** Then LangGraph-on-Hyperdrive is the researched alternative,
  and the cost is the typed channels across steps.
- **A client's product does not rest on provenance.** Then AutoRAG or Vectorize behind the existing
  `PolicySearch` port is a config change, which is the optionality the port already buys.
- **LangSmith becomes self-hostable without an Enterprise licence**, or the client is not residency-bound.
- **`effect/ai` grows a reranker or retriever abstraction**, at which point rule 1 applies and ours moves behind
  it.
