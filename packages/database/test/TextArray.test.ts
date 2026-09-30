/**
 * The empty-`text[]` trap, asserted at the level it is fixed.
 *
 * The driver infers a `text[]` parameter's element type from the first element, so an EMPTY array
 * fails to encode — which means `rails_fired` breaks precisely when no rail fired, and
 * `unverified_fields` breaks precisely when everything verified. The happy path breaks and the
 * unhappy path works, which is why this is in AGENTS.md.
 *
 * Tested against a recording tag rather than Postgres. What `textArray` owns is the SHAPE of the
 * parameter it hands the driver — one JSON string, never a JavaScript array — and that is decided
 * before any connection exists. The round trip through real Postgres is already covered by the
 * `tables` project, which has a container; duplicating it here would move this file into a tier that
 * needs infrastructure, for no extra information.
 */
import { textArray } from "@ea/database/Database"
import type { SqlClient } from "effect/sql"
import { describe, expect, it } from "vitest"

/**
 * A `sql` tag that records what it was interpolated with. Four lines, because that is all this uses.
 *
 * The `void` at each call site is deliberate: `textArray` returns a `Statement`, which the Effect language
 * service counts as Effect-able, so discarding it silently would be reported as a floating effect. Here the
 * statement genuinely is not run — the recording tag is the assertion target.
 */
const recordingSql = () => {
  const values: Array<unknown> = []
  const fragments: Array<string> = []
  const sql = ((strings: TemplateStringsArray, ...interpolated: ReadonlyArray<unknown>) => {
    fragments.push(...strings)
    values.push(...interpolated)
    return "statement"
  }) as unknown as SqlClient.SqlClient
  return { sql, values, fragments }
}

describe("textArray", () => {
  it("passes an EMPTY array as one JSON string, never as an array", () => {
    const { sql, values } = recordingSql()
    void textArray(sql, [])

    expect(values).toEqual(["[]"])
    // The assertion that matters: an array here is what the driver cannot encode.
    expect(Array.isArray(values[0])).toBe(false)
    expect(typeof values[0]).toBe("string")
  })

  it("passes a populated array the same way, so both paths encode alike", () => {
    const { sql, values } = recordingSql()
    void textArray(sql, ["grounding", "verbatim"])

    expect(values).toEqual(["[\"grounding\",\"verbatim\"]"])
    expect(typeof values[0]).toBe("string")
  })

  it("goes through jsonb, which is what makes the two paths identical", () => {
    const { sql, fragments } = recordingSql()
    void textArray(sql, [])
    expect(fragments.join("")).toContain("jsonb_array_elements_text")
  })

  it("does not lose an element that needs escaping", () => {
    const { sql, values } = recordingSql()
    void textArray(sql, ["he said \"no\"", "a,b"])
    expect(JSON.parse(values[0] as string)).toEqual(["he said \"no\"", "a,b"])
  })
})
