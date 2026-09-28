# Runbook — changing the embedding model

Written before it is needed, because the failure mode if you improvise is silent: the corpus keeps
answering queries, the answers are quietly worse, and nothing reports it.

## Why this is a migration and not a config change

Different embedding models occupy **different vector spaces**. A `mistral-embed` vector and a
`bge-m3` vector of the same sentence are not near each other in any meaningful sense — cosine
distance between them is noise. So a corpus containing both is not a corpus with two models in it;
it is a corpus where two-thirds of the distances are meaningless and retrieval silently degrades for
whichever half the query did not match.

Three things are tied to the model and all three have to move together:

| Thing                  | Where                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Vector width           | `EMBEDDING_DIMENSIONS` in `policy/domain/Chunk/Chunk.model.ts`, and the `vector(N)` column |
| The HNSW index         | `document_chunks_embedding_idx`, rebuilt after a width change                              |
| What produced each row | `document_chunks.embedding_model`, per chunk                                               |

`IndexPolicyDocument` refuses a profile whose `dimensions` disagrees with `EMBEDDING_DIMENSIONS`
**before writing anything**, so a mismatch fails at the first document rather than partway through a
long re-index.

## Same width (e.g. `mistral-embed` → another 1024-dim model)

No DDL change. The corpus is re-embedded in place, and the interesting property is that it stays
**usable throughout**: a chunk whose `embedded_at` is null is still retrievable lexically, so
retrieval degrades to `lexical` for the un-embedded portion rather than failing.

1. Confirm the gate still passes on the current corpus, so you have a before number:
   `bun run evals:retrieval`
2. Change `EMBEDDING_MODEL` (and `EMBEDDING_BASE_URL` if the provider changes — see
   ProviderProfiles.md, and note that routing Mistral _through_ OpenRouter defeats EU residency).
3. Invalidate the old vectors. Do this **per organization**, in batches, so that at no point is the
   whole corpus un-embedded:
   ```sql
   update document_chunks
      set embedding = null, embedding_model = null, embedded_at = null
    where organization_id = $1 and embedding_model = $2;
   ```
4. Re-run `IndexPolicyDocument` for each affected document. It replaces the document's chunks, so it
   is idempotent and safe to retry.
5. Re-run the gate. **A recall figure that did not improve is a reason to stop**, not a rounding
   error: you have paid for a re-embed and bought nothing.

## Different width

Everything above, plus DDL — and the corpus cannot serve semantic retrieval during the change, so
plan for `retrieval_mode = 'lexical'` for the duration and expect rail 4 to refuse auto-approval
throughout. That is correct behaviour, not a problem to work around.

1. Change `EMBEDDING_DIMENSIONS`, which the migration reads, so the code and the DDL cannot drift.
2. Add a migration that alters the column and rebuilds the index. `alter column ... type vector(N)`
   requires the column to be empty first, so null it in the same migration.
3. Re-index every document.

## What to check afterwards

- `select embedding_model, count(*) from document_chunks group by 1` — one row, or you have a mixed
  corpus and retrieval is quietly degraded for part of it.
- `select count(*) from document_chunks where embedding is null` — zero, or those chunks are
  lexical-only and rail 4 will keep refusing to auto-approve decisions that cite them.
- `bun run evals:retrieval`, compared against the number you recorded in step 1.

## The thing most likely to go wrong

Re-embedding with the **deterministic development embedder** by forgetting to set
`EMBEDDING_API_KEY`. Its vectors are content-addressed noise, it will happily embed the entire
corpus without error, and every distance afterwards is meaningless. `embedding_model` will read
`deterministic-hash-v1`, which is the check that catches it — and it is why
`EmbeddingProfile.semantic` exists and why the recall harness refuses to report a semantic figure
when it is false.
