# ADR-0006 — Provider profiles, and why routing Mistral through OpenRouter defeats the point

**Status:** accepted, partly unimplemented · **Date:** 2026-09-30

## Context

The three AI capabilities this product needs — a language model, an embedder, and a document parser — are
**ports** (`LanguageModel`, `Embedder`, `DocumentParser`). Nothing in `domain/` or `use-cases/` names a vendor,
and the scripted model in `decision/server/Extraction/ScriptedLanguageModel.ts` means the whole decide pipeline
runs with no key at all.

So the question is not how to abstract a provider. It is **which providers are admissible for which client**,
which is a data-residency question and therefore not an implementation detail.

## Decision

**Provider choice is a per-client profile, recorded, not a default.** Two profiles are intended:

| Profile  | For                         | Why it is a separate profile                                    |
| -------- | --------------------------- | --------------------------------------------------------------- |
| agnostic | development, non-EU clients | one key, many models; cheapest way to compare models            |
| **`eu`** | **EU / Dutch clients**      | **direct to an EU-jurisdiction provider, with no intermediary** |

**The reason there are two rather than one configurable base URL: an aggregator is an intermediary.**
OpenRouter is a US company, so routing a French model _through_ it means the request transits a US entity —
which defeats the residency argument entirely while looking, from the code, exactly like the EU path. The
difference is invisible in a config string and decisive in a DPA, so it is a profile with a name rather than a
URL with a comment.

Two constraints that belong in code, not in a footnote:

- **Stateless endpoints only.** Mistral's Zero Data Retention is available on the Scale plan and **only for
  stateless calls** — chat completions, embeddings, moderation, OCR, audio. It does **not** cover agents,
  batch, conversations or libraries. An adapter that reached for a stateful endpoint would silently void ZDR,
  so the restriction is asserted in the adapter.
- **An embedding swap is a data migration; a language-model swap is a config string.** Different models occupy
  different vector spaces, so the `vector(1024)` column and its HNSW index are tied to the embedder.
  `Embedder` therefore exposes `modelId` and `dimensions`, chunks carry `embedding_model` and a **nullable**
  `embedded_at`, and `docs/runbooks/ReEmbed.md` was written before it was needed.

## What is actually implemented today

Honesty matters more here than tidiness, because this ADR is the thing a client conversation would rest on:

- **Implemented:** Workers AI (`@cf/baai/bge-m3` at 1024 dimensions, and a Workers AI language model), an
  OpenAI-compatible adapter that any compatible base URL can use (`@ea/ai-openai`), a **deterministic**
  embedder for the eval harness, and the scripted language model.
- **Not implemented:** neither named profile exists as a selectable thing, there is no per-organization
  provider configuration, and no Mistral-specific client. The OpenAI-compatible adapter is the route by which
  the EU profile would be added — Mistral's API is OpenAI-shaped, which is why no `@effect/ai-mistral` is
  needed — but nothing selects it per client yet.
- **Consequence:** this product cannot today be sold to a client with a contractual EU-residency requirement,
  and the gap is configuration and a runbook rather than architecture.

`docs/runbooks/ProviderProfiles.md` is the missing piece that records each client's provider and plan tier,
which matters because ZDR is Scale-only.

## Revisit when

- **A client's residency requirement changes**, in either direction. A client who drops the requirement should
  move profile deliberately, not drift.
- **`@effect/ai-mistral` ships.** Then the EU profile is a client rather than a base URL, and the
  stateless-endpoints restriction can be enforced by the type rather than by the adapter's discipline.
- **A provider's jurisdiction changes** — an acquisition, or a new region. The profile is a statement about a
  company, not about a hostname.
- **Workers AI gains an EU-resident inference guarantee.** That would collapse two profiles into one and is the
  outcome that would most simplify this.
