/**
 * Splitting a document into retrievable pieces, as a port.
 *
 * A port because chunking is the variable most worth being able to swap and measure. It decides what a
 * citation can *be*, and the two credible strategies disagree about that in a way no amount of argument
 * settles:
 *
 *   `ChunkerHeading`    structure-aware. A chunk is a clause, and `clause_ref` comes from the heading.
 *   `ChunkerLangChain`  recursive token windows with overlap — what AutoRAG and most RAG stacks do.
 *
 * The recall gate runs both against the same gold-labelled queries, so the choice is a number rather
 * than a preference. That is the entire reason this interface exists.
 */
import { Context, type Effect } from "effect"
import type { DocumentChunk } from "./ChunkDocument.ts"

export interface ChunkerService {
  /** A name for reports and for `document_chunks.chunker`, so a corpus says how it was split. */
  readonly strategy: string
  readonly chunk: (
    markdown: string,
    options: { readonly title: string }
  ) => Effect.Effect<ReadonlyArray<DocumentChunk>>
}

export class Chunker extends Context.Service<Chunker, ChunkerService>()("policy/Chunker") {}
