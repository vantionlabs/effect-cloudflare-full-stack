/**
 * Every figure in an answer about the organization's data must come from the data.
 *
 * The documentation assistant refuses a citation it cannot find verbatim in what was retrieved; this is the same
 * rule for numbers. A figure in the answer must appear in what the tools returned (or in the question, or as
 * today's date). A model that adds two counts, averages them, or computes a percentage the tools did not give has
 * produced a number nobody can trace — and the answer is withheld, with the tools' own figures shown instead.
 *
 * Normalised so formatting cannot cause a false refusal: separators are dropped, so `457,38`, `457.38` and `€ 457,38`
 * are one figure, and leading zeros are dropped, so a date's `09` matches `9`. Rounding a source figure to whole
 * units is allowed (`457.38` may be said as `457`); computing a new one is not.
 */

/** The figures in a text, normalised. */
const figuresOf = (text: string): ReadonlyArray<string> =>
  (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((token) => token.replace(/[.,]/g, "").replace(/^0+(?=\d)/, ""))

/** Every figure a source may legitimately be quoted as: itself, and for a decimal its whole and rounded units. */
const acceptedForms = (text: string): ReadonlySet<string> => {
  const accepted = new Set<string>()
  for (const token of text.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const normalised = token.replace(/[.,]/g, "").replace(/^0+(?=\d)/, "")
    accepted.add(normalised)
    const decimal = /^(\d+)[.,](\d{1,2})$/.exec(token)
    if (decimal !== null) {
      const whole = Number(decimal[1])
      accepted.add(String(whole))
      accepted.add(String(Math.round(Number(`${decimal[1]}.${decimal[2]}`))))
    }
  }
  return accepted
}

/** The figures in `answer` that none of `sources` contains. Empty means every number can be traced. */
export const ungroundedFigures = (answer: string, sources: ReadonlyArray<string>): ReadonlyArray<string> => {
  const accepted = new Set<string>()
  for (const source of sources) for (const form of acceptedForms(source)) accepted.add(form)
  return [...new Set(figuresOf(answer).filter((figure) => !accepted.has(figure)))]
}
