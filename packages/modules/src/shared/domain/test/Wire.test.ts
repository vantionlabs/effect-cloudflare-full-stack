/**
 * The wire-type helper, which is now the only thing standing between a domain rename and a published contract.
 *
 * Every assertion is about that: that the projection actually drops what it does not list, that the rename
 * happens on the outside only, and that the known limitation of the rename is a known limitation rather than a
 * surprise.
 */
import { pageOf, wireFrom } from "@ea/modules/shared/domain/Wire"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

class Source extends Schema.Class<Source>("Source")({
  decisionId: Schema.String,
  documentId: Schema.String,
  railsFired: Schema.Array(Schema.String),
  grounded: Schema.Boolean,
  /** Not published below. The point of the projection is that this cannot leak by being added upstream. */
  internalNote: Schema.String
}) {}

const Wire = wireFrom(Source, ["decisionId", "documentId", "railsFired", "grounded"])

describe("wireFrom", () => {
  it("encodes camelCase to snake_case", () => {
    const encoded = Schema.encodeUnknownSync(Wire)({
      decisionId: "d1",
      documentId: "doc1",
      railsFired: ["grounding: no"],
      grounded: false
    })
    expect(encoded).toEqual({
      decision_id: "d1",
      document_id: "doc1",
      rails_fired: ["grounding: no"],
      grounded: false
    })
  })

  it("decodes from snake_case, so the same schema types a generated client", () => {
    const decoded = Schema.decodeSync(Wire)({
      decision_id: "d1",
      document_id: "doc1",
      rails_fired: [],
      grounded: true
    })
    expect(decoded.decisionId).toBe("d1")
    expect(decoded.railsFired).toEqual([])
  })

  /*
   * The projection, asserted from the outside. A field added to the domain type later must not appear in a
   * response, and this is the only thing that makes that true — the rename is derived, so without the explicit
   * key list every domain field would publish itself.
   */
  it("publishes only the listed fields", () => {
    const encoded = Schema.encodeUnknownSync(Wire)({
      decisionId: "d1",
      documentId: "doc1",
      railsFired: [],
      grounded: true
    }) as Record<string, unknown>
    expect(Object.keys(encoded).sort()).toEqual(["decision_id", "document_id", "grounded", "rails_fired"])
    expect(Object.keys(encoded)).not.toContain("internal_note")
    expect(Object.keys(encoded)).not.toContain("internalNote")
  })

  /*
   * The property that lets a handler return a DOMAIN value and get a projected response: an unpublished field
   * on the value is dropped at encode time rather than rejected. So the projection is enforced by the schema on
   * the way out, not by every handler remembering to pick — which is the difference between a rule and a habit.
   */
  it("DROPS an unpublished field rather than rejecting or leaking it", () => {
    const encoded = Schema.encodeUnknownSync(Wire)({
      decisionId: "d1",
      documentId: "doc1",
      railsFired: [],
      grounded: true,
      internalNote: "must not appear"
    }) as Record<string, unknown>

    expect(Object.keys(encoded).sort()).toEqual(["decision_id", "document_id", "grounded", "rails_fired"])
    expect(JSON.stringify(encoded)).not.toContain("must not appear")
  })

  it("refuses a payload missing a published field, rather than encoding undefined", () => {
    expect(() => Schema.encodeUnknownSync(Wire)({ decisionId: "d1" })).toThrow()
  })

  /*
   * The documented limitation. An underscore goes before every capital, so an acronym run breaks up. Asserted
   * rather than fixed: the rule is to not name a field this way, and a test is how that rule stays visible.
   */
  it("breaks up an acronym run, which is why fields are not named that way", () => {
    class Odd extends Schema.Class<Odd>("Odd")({ parsedHTML: Schema.String }) {}
    const encoded = Schema.encodeUnknownSync(wireFrom(Odd, ["parsedHTML"]))({ parsedHTML: "x" })
    expect(Object.keys(encoded)).toEqual(["parsed_h_t_m_l"])
  })

  it("leaves an already-lowercase field alone", () => {
    class Plain extends Schema.Class<Plain>("Plain")({ status: Schema.String }) {}
    expect(Schema.encodeUnknownSync(wireFrom(Plain, ["status"]))({ status: "ok" })).toEqual({ status: "ok" })
  })
})

describe("pageOf", () => {
  const Page = pageOf(Wire)

  it("carries the items and a cursor", () => {
    const encoded = Schema.encodeUnknownSync(Page)({
      items: [{ decisionId: "d1", documentId: "doc1", railsFired: [], grounded: true }],
      next_cursor: "abc"
    }) as { readonly items: ReadonlyArray<Record<string, unknown>>; readonly next_cursor: string | null }

    expect(encoded.next_cursor).toBe("abc")
    expect(Object.keys(encoded.items[0]!)).toContain("decision_id")
  })

  it("accepts a null cursor, which is how the end of a collection is stated", () => {
    const encoded = Schema.encodeUnknownSync(Page)({ items: [], next_cursor: null })
    expect(encoded).toEqual({ items: [], next_cursor: null })
  })

  it("requires next_cursor to be PRESENT even when null", () => {
    // Absent and null are different to a generated client: one is "no more pages", the other is a field the
    // server forgot. The same argument as `HealthV1.database`, which has its own test for the same reason.
    expect(() => Schema.decodeUnknownSync(Page)({ items: [] })).toThrow()
  })
})
