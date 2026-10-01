# Agents, search and the next Beautiful UI components

Logged 2026-10-01, after checking the live account with the Cloudflare MCP and the current AI Search docs.

## Where things stand

- **RAG is our own**, in Postgres: pgvector (1024-d) + Dutch full-text search fused by RRF in one SQL statement,
  heading-aware chunks, `@cf/baai/bge-m3` embeddings via AI Gateway. Measured 2026-09-30: hybrid 100% at k=3 on the
  gold set, lexical 84.6%. No AI Search instance exists in the account.
- **Cloudflare AI in use:** Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast` for every language-model call,
  `@cf/baai/bge-m3` for embeddings), AI Gateway (one per environment), the Agents SDK (one Durable Object per docs
  conversation). Not used: Vectorize, AI Search, Browser Run.
- **The Agents SDK has no console surface.** `Assistant.ask` / `Assistant.history` exist and are tested; no page calls
  them, so "Ask the docs" forgets every question.
- **Ingestion only reads `.md` and `.txt`.** Manuals and schematics are PDFs, often scanned.

## Why not AI Search (yet) — the honest version

AI Search now has hybrid search, reranking, per-tenant instances and managed PDF/OCR ingestion, so "it cannot" is
no longer the argument. What still favours pgvector: its keyword tokenizer is `porter` (English) or `trigram`, where
Postgres has Dutch Snowball stemming; it does not run locally (`remote: true`), so the retrieval gate and the test
suite would need network and paid queries; usage is billed past 1,000 queries a month; and one store keeps the
citable text and its vector from drifting. The citation check (verbatim against served chunks) would work on its
results too, so that is not a reason either way. Issue 06 measures instead of arguing.

## Order

1 → 2 first (recommended), then the rest by value. Issue 07 runs alongside: each feature brings its components.
