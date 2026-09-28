/**
 * Every extracted value carries the words it was read from.
 *
 * This is the product's central claim made structural: a row used to pay an invoice must be
 * traceable to text on the page. `ExtractedField` is the only way a value enters the pipeline, so
 * a field without provenance is not merely discouraged, it is unrepresentable.
 *
 * **Field order is load-bearing, and one of these two orderings is measured.**
 *
 * `source_span` is declared **before** `value`. A model generating JSON emits keys in schema order,
 * so it must quote the document before it commits to a reading — which makes the quote a constraint
 * on the answer rather than a justification written afterwards. docket measured the same effect on a
 * sibling schema: putting `citations` after `rationale` accounted for **25 of 66 grounding failures
 * on a 99-case run**, because the model wrote `[7]` mid-paragraph and only then worked out what
 * citation 7 was.
 *
 * For spans this is a **hypothesis, not a measurement** (ADR-0008). It follows the same logic and
 * is the eval harness's first A/B. Recorded here so that whoever runs it knows the current order was
 * a bet, and what the bet was.
 */
import { Schema } from "effect"

/**
 * One extracted value, plus the text it was read from.
 *
 * `value` is a schema parameter so a vertical declares what it expects — but note what the verticals
 * actually use: **`Schema.String` for every amount.** Money is extracted as the digits exactly as
 * printed, because that string is also what `source_span` quotes, and converting inside the model's
 * output would put a silent reformatting between the document and the check. Conversion happens in
 * `parseMoney`, which refuses what it cannot read exactly.
 */
export const ExtractedField = <S extends Schema.Top>(value: S) =>
  Schema.Struct({
    /**
     * The verbatim text from the document this value was read from.
     *
     * The description is part of the prompt — it reaches the model through the JSON schema — so it
     * is written as an instruction rather than as documentation for us.
     */
    source_span: Schema.String.annotate({
      description: "The verbatim text from the document this value was read from. Copy it exactly " +
        "as it appears; do not paraphrase, reformat numbers or dates inside it, or translate it. " +
        "If the document does not state this field, omit the field rather than inventing a span."
    }),
    /** 1-based page the span appears on, when the parser established pages. */
    page: Schema.optional(Schema.Int),
    value
  })

export type ExtractedField<A> = {
  readonly source_span: string
  readonly page?: number | undefined
  readonly value: A
}
