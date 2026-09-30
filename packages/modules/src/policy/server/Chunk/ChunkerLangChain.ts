/**
 * LangChain's `RecursiveCharacterTextSplitter` behind the `Chunker` port.
 *
 * This is what most RAG stacks do, and what AutoRAG does internally: recursive token windows with
 * overlap, splitting at paragraphs then sentences. It is here to be **measured against** the
 * heading-based chunker on the same gold-labelled queries, rather than argued about.
 *
 * Two consequences of the strategy that the report should be read with in mind:
 *
 * 1. **No `clause_ref`.** A window has no heading, so there is nothing to lift. The obligations index
 *    (slice 1.5) fetches applicable rules BY reference, bypassing ranking, and cannot be built on
 *    chunks that do not carry one. This adapter therefore recovers a best-effort reference by scanning
 *    backwards for the nearest preceding heading — honest about being an approximation, because a
 *    window can straddle two clauses and then the reference is simply wrong for part of it.
 * 2. **Overlap duplicates text across chunk ids.** The same sentence can be cited under two different
 *    ids, so "cite chunk X" stops being a stable reference to a single piece of policy.
 *
 * Neither is a reason not to measure it. Recall might be better, and if it is, that is worth knowing.
 */
import { Chunker, type ChunkerService, type DocumentChunk } from "@ea/modules/policy/domain/Chunk"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { Effect, Layer } from "effect"

/**
 * Defaults. Parameterised because a single chunk size makes any comparison meaningless.
 *
 * Learned the hard way: measured once at 1200 characters against a 1,800-character fixture corpus, this
 * strategy produced **two chunks** — the whole document in two pieces — and scored 7.7% recall@3. That
 * number was about the chunk size, not the strategy. A comparison has to sweep the size and report the
 * strategy's best showing, or it is just a rigged fight.
 */
const DEFAULT_CHUNK_SIZE = 1200
/** 10%, kept proportional to size so duplication does not vary with the sweep. */
const DEFAULT_OVERLAP_RATIO = 0.1

const HEADING = /^(#{1,6})\s+(.*)$/

/** The nearest heading at or before `offset`, for a best-effort clause reference. */
const headingBefore = (markdown: string, offset: number): string | null => {
  let found: string | null = null
  let position = 0
  for (const line of markdown.split("\n")) {
    if (position > offset) break
    const match = HEADING.exec(line)
    if (match !== null) found = match[2]!.trim()
    position += line.length + 1
  }
  return found
}

/**
 * Lifts a clause reference the same way the heading chunker does, so the comparison is not
 * accidentally measuring two different reference formats.
 */
const clauseRefOf = (heading: string | null): string | null => {
  if (heading === null) return null
  const named = /^\s*(artikel|art\.|article|section|§|bijlage|annex)\s*([\dIVXLC]+(?:\.\d+)*|[A-Z])\b/i
    .exec(heading)
  if (named !== null) {
    const label = named[1]!.replace(/\.$/, "")
    const normalised = label.toLowerCase() === "art" ? "Artikel" : label[0]!.toUpperCase() + label.slice(1)
    return `${normalised} ${named[2]!}`
  }
  const bare = /^\s*(\d+(?:\.\d+)+)\s+\S/.exec(heading)
  return bare === null ? null : bare[1]!
}

export const chunkerLangChain = (chunkSize: number = DEFAULT_CHUNK_SIZE): Layer.Layer<Chunker> =>
  Layer.succeed(Chunker)(
    {
      strategy: `langchain-recursive/${chunkSize}`,
      chunk: (markdown, options) =>
        Effect.promise(async () => {
          const splitter = new RecursiveCharacterTextSplitter({
            chunkSize,
            chunkOverlap: Math.round(chunkSize * DEFAULT_OVERLAP_RATIO)
          })
          const parts = await splitter.splitText(markdown)

          const chunks: Array<DocumentChunk> = []
          let cursor = 0
          for (const [ordinal, content] of parts.entries()) {
            // Locate the window in the source so a heading can be recovered. `indexOf` from the cursor
            // rather than from zero, because overlap means an earlier match would be the wrong one.
            const at = markdown.indexOf(content.slice(0, 40), cursor)
            const offset = at === -1 ? cursor : at
            cursor = offset + 1
            const heading = headingBefore(markdown, offset)

            chunks.push({
              ordinal,
              heading,
              headingPath: [],
              clauseRef: clauseRefOf(heading),
              content,
              // The same contextual prefix idea, so the embedding input differs only by how the text was
              // cut. Without this the comparison would confound chunking with prefixing.
              contextPrefix: [options.title, heading].filter((part): part is string => part !== null).join(" > "),
              tokenEstimate: Math.ceil(content.length / 4)
            })
          }
          return chunks
        })
    } satisfies ChunkerService
  )

/** The default-sized instance, for composition roots that do not care to tune it. */
export const ChunkerLangChain: Layer.Layer<Chunker> = chunkerLangChain()
