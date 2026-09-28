/**
 * The verbatim check: is this excerpt really in that source text?
 *
 * One implementation, used by everything that claims a quote — extraction field spans, answer
 * citations, policy excerpts. Same discipline in all three places: a model may only claim what it
 * can quote. It is in `shared/domain` rather than a slice precisely because those three callers are
 * in three different slices and must not be able to disagree.
 *
 * The reviewer console highlights a span with this same function, so a highlight cannot disagree
 * with the rail that decided whether the span verified.
 */

/** Collapse whitespace and case-fold, so re-wrapping is not a mismatch. */
export const normalize = (text: string): string => text.split(/\s+/).filter(Boolean).join(" ").toLowerCase()

/**
 * True when `excerpt` appears in `source` under normalization.
 *
 * Matching is whitespace-normalised and case-insensitive, because a model that re-wraps a line or
 * lowercases a heading has not invented anything. **Nothing else is normalised**: punctuation,
 * digits and currency symbols must match, since those are exactly the characters worth lying about.
 *
 * An empty excerpt is never verbatim. It quotes nothing, so it proves nothing, and returning true
 * would let a blank span verify against any document at all.
 */
export const containsVerbatim = (excerpt: string, source: string): boolean => {
  const normalized = normalize(excerpt)
  return normalized.length > 0 && normalize(source).includes(normalized)
}
