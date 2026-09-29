/**
 * Highlighting a cited excerpt inside the clause it claims to come from.
 *
 * **It shares `normalize` with the rail**, and the test asserts the stronger property: that `locate` finds a
 * span exactly when `containsVerbatim` returns true. That is the point, not a convenience: rail 2 decided
 * whether this citation verified, and if the highlighter matched by different rules the reviewer would see a
 * highlight on a span the rail rejected, or no highlight on one it accepted. Either way the UI would be
 * quietly contradicting the decision it is displaying.
 *
 * The normalisation is therefore shared too. Whitespace and case are ignored — a model that re-wrapped a line
 * invented nothing — while punctuation, digits and currency symbols must match exactly, because those are the
 * characters worth lying about. Which means the highlight has to be located in the ORIGINAL text while
 * matching against the normalised form, and that mapping is the only real work here.
 */
import { normalize } from "@ea/modules/shared/domain/Verbatim"

interface HighlightProps {
  readonly text: string
  readonly excerpt: string
}

/**
 * Finds the excerpt's span in the original text.
 *
 * Walks the original, normalising as it goes, and records where the normalised match begins and ends. A
 * simple `indexOf` on the original would fail on exactly the cases normalisation exists to allow — a
 * re-wrapped line, a lowercased heading — and would then show no highlight on a citation the rail verified.
 */
export const locate = (text: string, excerpt: string): readonly [number, number] | null => {
  const target = normalize(excerpt)
  if (target === "") return null

  // Normalised position of each original index, so a match in normalised space maps back.
  const positions: Array<number> = []
  let normalised = ""
  let lastWasSpace = true

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (/\s/.test(char)) {
      if (!lastWasSpace && normalised !== "") {
        normalised += " "
        positions.push(index)
      }
      lastWasSpace = true
      continue
    }
    normalised += char.toLowerCase()
    positions.push(index)
    lastWasSpace = false
  }

  const at = normalised.indexOf(target)
  if (at === -1) return null
  const start = positions[at]!
  const end = positions[Math.min(at + target.length - 1, positions.length - 1)]! + 1
  return [start, end]
}

export function Highlight({ excerpt, text }: HighlightProps) {
  const span = locate(text, excerpt)

  if (span === null) {
    /*
     * The citation does not occur in the clause.
     *
     * Shown rather than hidden, and labelled. Rail 2 already escalated this decision to a human, so the
     * reviewer's job is to see WHY — and "the quote is not in the clause" is the most important thing the
     * screen can say. Silently rendering the clause unhighlighted would hide the finding.
     */
    return (
      <div data-unverified="true" style={{ borderLeft: "3px solid #b00", paddingLeft: "0.75rem" }}>
        <p style={{ color: "#b00", fontWeight: 600, margin: "0 0 0.5rem" }}>
          not verbatim in this clause
        </p>
        <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{text}</pre>
      </div>
    )
  }

  const [start, end] = span
  return (
    <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
      {text.slice(0, start)}
      <mark data-verified="true">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </pre>
  )
}
