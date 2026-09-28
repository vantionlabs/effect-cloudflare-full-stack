/**
 * Retrieving applicable policy, as a port.
 *
 * `decision` needs the capability "find the clauses that bear on this document"; it has no business
 * knowing that the answer comes from pgvector, a Dutch tsvector index and RRF fused in one SQL
 * function. `policy` provides that, `decision` asks for this, and the composition root joins them —
 * which is the same shape as `DocumentParser`, `Blobs` and `Ids`.
 *
 * Two things this buys beyond tidiness:
 *
 * - **Slice isolation stays npm-checkable in spirit and `dep:check`-checkable in fact.** Before the
 *   port, `decision/use-cases` imported `policy/use-cases` directly, which is the kind of edge that
 *   accumulates silently until the two slices cannot be reasoned about separately.
 * - **The decide pipeline becomes testable against a fake corpus.** A fake returning three clauses and
 *   a mode is four lines, so rail behaviour can be exercised without a database.
 */
import { Context, type Effect } from "effect"
import type { Collection } from "../Corpus/Collection.ts"
import type { Retrieval } from "./Retrieval.model.ts"

export interface PolicySearchService {
  readonly search: (input: {
    readonly query: string
    readonly limit?: number | undefined
    /** Defaults to the policy corpus. A transactional document must be asked for explicitly. */
    readonly collection?: Collection | undefined
  }) => Effect.Effect<Retrieval>
}

export class PolicySearch extends Context.Service<PolicySearch, PolicySearchService>()(
  "policy/PolicySearch"
) {}
