# ADR-0004 — pgvector in the one Postgres, not Vectorize

**Status:** accepted · **Date:** 2026-09-30 (decided in `PLAN.md` before the repo existed; written now, with the
code as evidence rather than the argument as prediction)

## Context

Cloudflare's own answer for vector search is Vectorize, and this is an all-Cloudflare deployment otherwise. The
number this product handles is small — a hundred client organizations at ~2,000 chunks each is ~200,000 vectors
— which is far inside what either option manages. So Vectorize's advantage, managed ANN at 20M vectors per
index, is an advantage over a problem nobody here has.

Against that, choosing it costs a second store, and the cost is specific rather than general.

## Decision

**One Postgres holds the vector, the text and everything joined to them.** `document_chunks.embedding` is a
`vector(1024)` column in the same row as the `content` a citation quotes
(`packages/modules/src/policy/tables/Chunk/ChunkTable.ts`), with an HNSW index, beside a
`to_tsvector('dutch', …)` column in the same table.

## Why, in the order the reasons actually matter

**1. Two stores means the vector and the citable text can diverge, and this product's whole claim is that they
cannot.** A decision is defensible because every citation carries a verbatim excerpt somebody can audit a year
later. With a separate vector index, a partial ingest is representable: a vector exists whose text does not,
or vice versa. That is not a hypothetical class of bug — it forces `embedded_at IS NULL` handling, a
reconciliation query and an ordering rule, and the failure mode is a citation that resolves to nothing. In one
store the chunk and its embedding are one row and one transaction.

**2. Hybrid retrieval is one SQL function, so it is transactionally consistent.** RRF over a semantic CTE and a
lexical CTE, fused in the database, with the tenant predicate and the `collection` filter in the same `where`.
Across two stores the same thing is two round trips fused in Worker code, which introduces a partial-failure
mode: one half answers and the other does not, and the honest handling of that is a `retrieval_mode` this
design already records but would then have to _degrade_ far more often. As it stands, if embeddings are
unavailable, **ingestion** stalls — which is visible — rather than retrieval quietly going lexical.

**3. Arbitrary joins and filters.** Vectorize allows a bounded set of indexed metadata fields; the retrieval
function here filters on the organization, the collection, and `in_force`, and joins to whatever the obligations
index needs. None of that is metadata attached to a vector — it is the schema.

**4. The eval harness and local development get the real thing.** `evals/` runs real pgvector in a container
(ADR-0015), so retrieval recall is measured against the engine production uses. Vectorize has no local
emulator, which would make the retrieval gate — the one number this product's quality rests on — measurable
only against a deployed index.

**5. The embedding-model constraint disappears.** `@cf/baai/bge-m3` at 1024 dimensions fits comfortably;
pgvector indexes well past that, so a future model is a migration of data rather than of store.

## What this costs

- **pgvector index tuning is ours.** HNSW parameters, and the `maintenance_work_mem` a rebuild wants, are
  operational surface Vectorize would have absorbed.
- **The vectors sit in the same instance as transactional load**, so a large re-embed competes with the review
  queue for the same connections. Hyperdrive's two bindings (ADR-0002) exist partly for this.
- **No free tier for idle**, because the database bills whether or not anything is searching.

## Revisit when

- **Vectors exceed a few million**, where HNSW build time and memory stop being incidental. At ~200,000 they
  are not the constraint; at 5M+ the arithmetic is different and worth redoing rather than arguing about.
- **Index tuning becomes the bottleneck** rather than retrieval quality. If the answer to a recall problem is
  repeatedly "tune the index", a managed ANN service is buying something real.
- **A tenant needs its corpus physically separated** in a way one Postgres cannot express. Note this is an
  argument for a second _database_, not for Vectorize.
