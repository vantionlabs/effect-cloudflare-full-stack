/**
 * The first model-free check: does every quoted span actually occur in the document?
 *
 * No model call, no cost, no network — and it catches the failure that actually matters, which is a
 * plausible number the document never contained. A field whose span does not verify is *unverified*
 * and may never feed an automatic decision (rail 2).
 *
 * **How fields are recognised, and why it is not the obvious way.** TypeScript has no runtime type
 * information, so unlike docket's `isinstance(value, ExtractedField)` there is nothing to ask. This
 * walks the decoded value with a **structural predicate**: an object with a string `source_span`, a
 * `value`, and no other keys besides an optional numeric `page`. The `no other keys` clause is what
 * stops an ordinary nested object from being mistaken for a field.
 *
 * A structural predicate can still be wrong in one direction: it can *miss* a field whose shape
 * drifts. A missed field is indistinguishable from a passing one, which is the dangerous failure —
 * so each vertical additionally **declares the paths it expects** and a test asserts the walker finds
 * exactly that set. Deriving the paths from the schema AST was considered and rejected: it would
 * share the bug with the walker, and two independent statements of the same fact is the point.
 */
import { containsVerbatim } from "@ea/modules/shared/domain/Verbatim"

/** Which field paths failed the verbatim check, as dotted paths like `line_items.2.amount`. */
export interface VerificationReport {
  readonly unverified: ReadonlyArray<string>
  readonly checked: ReadonlyArray<string>
}

export const isVerified = (report: VerificationReport): boolean => report.unverified.length === 0

interface FieldShape {
  readonly source_span: string
  readonly page?: unknown
  readonly value: unknown
}

/**
 * Whether `candidate` is an extracted field rather than a nested object that happens to contain one.
 *
 * The key-set check is the load-bearing part. Without it, any object carrying a `source_span` would
 * be treated as a leaf and its own nested fields would never be walked.
 */
const isExtractedField = (candidate: unknown): candidate is FieldShape => {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return false
  const record = candidate as Record<string, unknown>
  if (typeof record["source_span"] !== "string") return false
  if (!("value" in record)) return false
  const page = record["page"]
  if (page !== undefined && typeof page !== "number") return false
  return Object.keys(record).every((key) => key === "source_span" || key === "page" || key === "value")
}

/** Checks every `ExtractedField` span in `extracted` against `documentText`. */
export const verifySpans = (extracted: unknown, documentText: string): VerificationReport => {
  const unverified: Array<string> = []
  const checked: Array<string> = []

  const walk = (node: unknown, path: string): void => {
    if (isExtractedField(node)) {
      checked.push(path)
      if (!containsVerbatim(node.source_span, documentText)) unverified.push(path)
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, path === "" ? String(index) : `${path}.${index}`))
      return
    }
    if (typeof node === "object" && node !== null) {
      for (const [key, item] of Object.entries(node)) {
        walk(item, path === "" ? key : `${path}.${key}`)
      }
    }
  }

  walk(extracted, "")
  return { unverified, checked }
}
