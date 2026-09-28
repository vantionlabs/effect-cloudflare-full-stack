/**
 * Splitting a policy document into retrievable, citable pieces.
 *
 * Pure: no platform, no model, no database. Chunking decides what a citation can *be*, so it is
 * worth being able to test exhaustively and cheaply.
 *
 * **By heading, not by fixed window.** A sliding window is simpler and wrong for this product. A
 * citation has to be quotable and checkable, so a chunk boundary in the middle of a sentence produces
 * a span nobody can verify and a clause reference that points at half a rule. Policy documents already
 * carry their own structure in their headings; using it means a chunk is a clause.
 *
 * **The contextual prefix.** A chunk reading "This requires two approvals" is nearly unembeddable on
 * its own — "this" refers to something in the heading above it. So the document title and heading path
 * are prepended before embedding: `Inkoopbeleid > Artikel 3 Inkoopverplichtingen\n\nFacturen boven…`.
 * The prefix is **stored**, because a vector is only interpretable against the exact text that
 * produced it, and it is **not** part of `content` — a citation must quote the clause, not our
 * scaffolding, or `containsVerbatim` would verify text that is not in the document.
 */

/** Roughly four characters per token for Dutch and English prose. Good enough to bound a chunk. */
const CHARS_PER_TOKEN = 4

/**
 * Target ceiling on a chunk's content, in characters.
 *
 * ~1200 characters is ~300 tokens: large enough that a rule stays whole, small enough that a
 * retrieved chunk is precise rather than a page the reviewer has to scan. Sections above it are split
 * at paragraph boundaries, never mid-sentence.
 */
const MAX_CONTENT_CHARS = 1200

export interface DocumentChunk {
  readonly ordinal: number
  /** The heading this content sits under, or null above the first heading. */
  readonly heading: string | null
  /** Ancestor headings, outermost first, for the contextual prefix and for display. */
  readonly headingPath: ReadonlyArray<string>
  /** The citable reference lifted from the heading, e.g. `Artikel 3.2`. Null when unnumbered. */
  readonly clauseRef: string | null
  /** What a citation quotes and what `containsVerbatim` checks. Excludes the prefix. */
  readonly content: string
  /** Prepended to `content` before embedding. Stored, because it shaped the vector. */
  readonly contextPrefix: string
  readonly tokenEstimate: number
}

/** The text handed to the embedder: prefix, then content. One place, so indexing and any
 * re-embedding cannot disagree about what was embedded. */
export const embeddableText = (chunk: DocumentChunk): string =>
  chunk.contextPrefix === "" ? chunk.content : `${chunk.contextPrefix}\n\n${chunk.content}`

/**
 * Lifts a citable reference out of a heading.
 *
 * Deliberately conservative: it recognises the forms Dutch policy documents actually use and returns
 * null otherwise. A wrong `clause_ref` is worse than none — the obligations index (slice 1.5) fetches
 * applicable rules BY this reference, so a mis-parsed one silently retrieves the wrong rule while
 * looking entirely correct.
 */
const clauseRefOf = (heading: string): string | null => {
  // The reference may be numeric (`Artikel 3.2`), Roman (`Artikel IV`) or a single letter —
  // annexes are conventionally lettered, as in `Bijlage A`.
  const named = /^\s*(artikel|art\.|article|section|§|bijlage|annex)\s*([\dIVXLC]+(?:\.\d+)*|[A-Z])\b/i
    .exec(heading)
  if (named !== null) {
    const label = named[1]!.replace(/\.$/, "")
    const normalised = label.toLowerCase() === "art" ? "Artikel" : label[0]!.toUpperCase() + label.slice(1)
    return `${normalised} ${named[2]!}`
  }
  // A bare leading number, as in "3.2 Betalingstermijn". Requires a following space so a heading
  // beginning with a year or an amount is not mistaken for a clause number.
  const bare = /^\s*(\d+(?:\.\d+)+)\s+\S/.exec(heading)
  return bare === null ? null : bare[1]!
}

/** Splits oversized content at paragraph boundaries, never mid-sentence. */
const splitParagraphs = (content: string): ReadonlyArray<string> => {
  if (content.length <= MAX_CONTENT_CHARS) return [content]
  const parts: Array<string> = []
  let current = ""
  for (const paragraph of content.split(/\n\s*\n/)) {
    const candidate = current === "" ? paragraph : `${current}\n\n${paragraph}`
    if (candidate.length > MAX_CONTENT_CHARS && current !== "") {
      parts.push(current)
      current = paragraph
    } else {
      current = candidate
    }
  }
  if (current !== "") parts.push(current)
  return parts
}

const HEADING = /^(#{1,6})\s+(.*)$/

export interface ChunkOptions {
  /** The document's title, which heads every contextual prefix. Usually the filename or its H1. */
  readonly title: string
}

export const chunkDocument = (
  markdown: string,
  options: ChunkOptions
): ReadonlyArray<DocumentChunk> => {
  interface Section {
    readonly heading: string | null
    readonly headingPath: ReadonlyArray<string>
    readonly lines: Array<string>
  }

  const sections: Array<Section> = []
  // Index 0 is unused; a level-1 heading writes stack[1]. Keeps the arithmetic obvious.
  const stack: Array<string> = []
  let current: Section = { heading: null, headingPath: [], lines: [] }

  for (const line of markdown.split("\n")) {
    const match = HEADING.exec(line)
    if (match === null) {
      current.lines.push(line)
      continue
    }
    if (current.lines.join("\n").trim() !== "" || current.heading !== null) sections.push(current)

    const level = match[1]!.length
    const heading = match[2]!.trim()
    stack.length = level - 1
    stack[level - 1] = heading
    current = {
      heading,
      // Ancestors only: the chunk's own heading is not repeated in its path.
      headingPath: stack.slice(0, level - 1).filter((entry) => entry !== undefined),
      lines: []
    }
  }
  if (current.lines.join("\n").trim() !== "" || current.heading !== null) sections.push(current)

  const chunks: Array<DocumentChunk> = []
  for (const section of sections) {
    const content = section.lines.join("\n").trim()
    // A heading with no body of its own is a container, not a clause. Emitting it would put an
    // empty chunk in the corpus, which can never be cited and can still be retrieved.
    if (content === "") continue

    const prefixParts = [options.title, ...section.headingPath, section.heading].filter(
      (part): part is string => part !== null && part !== ""
    )
    const contextPrefix = prefixParts.join(" > ")
    const clauseRef = section.heading === null ? null : clauseRefOf(section.heading)

    for (const part of splitParagraphs(content)) {
      chunks.push({
        ordinal: chunks.length,
        heading: section.heading,
        headingPath: section.headingPath,
        clauseRef,
        content: part,
        contextPrefix,
        tokenEstimate: Math.ceil((contextPrefix.length + part.length) / CHARS_PER_TOKEN)
      })
    }
  }

  return chunks
}
