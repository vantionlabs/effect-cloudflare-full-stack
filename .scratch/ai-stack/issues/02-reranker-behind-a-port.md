# A reranker behind a port, admitted only if `evals:retrieval` says so

Status: ready-for-agent

Rule 1 of ADR-0023: a thing that fits under a port is adopted freely, and the eval decides whether it
helped. This is the worked example.

`@cf/baai/bge-reranker-base` is a cross-encoder — it reads the query and the candidate _together_ rather
than comparing two independently-made vectors, which is why it beats RRF on ordering and why it cannot be
the retrieval step itself. Shape: over-retrieve with the existing hybrid function, then rerank the top ~50
to a final ~8.

## What makes this safe to add

The provenance chain is untouched. Reranking permutes an ordered list of chunks that have already been
retrieved from our own Postgres; `chunk_id` and the stored text are unchanged, so `containsVerbatim` and
rail 2 behave identically. Contrast with AutoRAG, which rule 3 rejects precisely because it _does_ own
that chain.

## Acceptance

- A `Reranker` port in `policy/domain`, with a pass-through implementation as the default. Pass-through
  rather than optional so there is no branch in the caller, and so "no reranker" is a measurable arm.
- `evals:retrieval` gains a `hybrid+rerank` strategy column beside the existing sweep, on the same gold
  queries.
- **Admitted only if it beats `hybrid` on the gate.** If it does not, keep the port, keep the number, and
  record the negative result in `docs/references.md` — a measured "this did not help on our corpus" is
  worth more than an untested dependency, and is exactly what the LangChain splitter comparison produced.
- Cost noted per run. It is the cheapest model in the catalogue, and 50 candidates per question is 50
  inferences, so it is not free at eval scale.

Blocked on the same thing as everything else measurable: neurons. Do not merge on a run that was skipped.
