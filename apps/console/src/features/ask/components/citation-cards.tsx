/**
 * The passages an answer relies on, as Beautiful UI's `ContextCards`.
 *
 * Every field is what retrieval recorded — the excerpt verbatim (it was verified against the search results before
 * the server answered), the section heading and the document — never the model's own labelling. Nothing here is
 * invented: the badge is the document's file extension, and a missing heading says so rather than guessing one.
 */
import ContextCards, { type ContextChunk } from "@/components/primitives/ContextCards"
import type { AskAnswerCitation } from "@ea/modules/policy/domain/Ask"

const extensionOf = (document: string | null | undefined): string => {
  const match = document?.match(/\.([a-z0-9]{1,4})$/i)
  return match === undefined || match === null ? "DOC" : match[1]!.toUpperCase()
}

export function CitationCards(props: { readonly citations: ReadonlyArray<AskAnswerCitation> }) {
  /*
   * `ContextCards` keys its cards by title, so two excerpts from one section would collide. The second gets a
   * visible ordinal — "2. Hydraulische druk (2)" — which is true (it IS the second passage from there) and keeps
   * both on screen. The count in the header is the number of passages actually cited, computed here.
   */
  const seen = new Map<string, number>()
  const chunks: Array<ContextChunk> = props.citations.map((citation) => {
    const base = citation.heading ?? citation.clause_ref ?? "Geciteerde passage"
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return {
      title: count === 1 ? base : `${base} (${count})`,
      chars: `${citation.excerpt.length} tekens`,
      body: citation.excerpt,
      source: citation.document ?? "documentatie",
      badge: extensionOf(citation.document),
      tone: "bg-accent"
    }
  })
  return <ContextCards chunks={chunks} labels={{ header: "Bronnen", count: String(chunks.length) }} />
}
