/**
 * The cursor's properties, tested where they are decided.
 *
 * Every assertion here is about a way pagination goes wrong quietly: a separator that a user's room name could
 * contain, a malformed cursor that restarts the loop at page one instead of failing, and a full last page that
 * reports no successor and silently truncates a client's read.
 */
import {
  clampPageSize,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  MAX_PAGE_SIZE,
  nextCursor
} from "@ea/modules/shared/domain/Page"
import { Result } from "effect"
import { describe, expect, it } from "vitest"

describe("clampPageSize", () => {
  it("defaults when absent and clamps to the ceiling", () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE)
    expect(clampPageSize(10)).toBe(10)
    expect(clampPageSize(MAX_PAGE_SIZE + 1000)).toBe(MAX_PAGE_SIZE)
  })

  it("refuses zero and negatives, which would otherwise be an empty page forever", () => {
    expect(clampPageSize(0)).toBe(1)
    expect(clampPageSize(-5)).toBe(1)
  })

  it("truncates a fractional limit rather than passing it to SQL", () => {
    // `limit 10.5` is a syntax error, and a query built from a query-string number can get here.
    expect(clampPageSize(10.5)).toBe(10)
  })
})

describe("the cursor", () => {
  it("round-trips a compound key", () => {
    const decoded = decodeCursor(encodeCursor(["2026-09-30T12:00:00.000Z", "01930f2c-0000"]))
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toEqual(["2026-09-30T12:00:00.000Z", "01930f2c-0000"])
    }
  })

  /*
   * The assertion the separator was chosen for. One of these keys is a ROOM NAME, which a user types — so a
   * name containing the separator is not a hypothetical, and splitting on a raw character would silently
   * produce a three-part key from a two-part cursor and page from the wrong row.
   */
  it("survives a key containing the separator", () => {
    const decoded = decodeCursor(encodeCursor(["a ~ tricky ~ name", "id-1"]))
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isSuccess(decoded)) expect(decoded.success).toEqual(["a ~ tricky ~ name", "id-1"])
  })

  it("survives the other characters a room name can hold", () => {
    // Includes every character `encodeURIComponent` leaves unescaped, since one of those was the first
    // separator and each is a candidate for the same mistake.
    for (const name of ["50% done", "a+b", "a&b", "a/b", "ü", "emoji 🙂", "a b", "-_.!~*'()"]) {
      const decoded = decodeCursor(encodeCursor([name, "id-1"]))
      expect(Result.isSuccess(decoded) && decoded.success[0]).toBe(name)
    }
  })

  it("FAILS on a malformed cursor rather than starting over", () => {
    // A lone `%` is an invalid escape, which is what a truncated cursor looks like in a URL.
    expect(Result.isFailure(decodeCursor("%"))).toBe(true)
    expect(Result.isFailure(decodeCursor(""))).toBe(true)
  })
})

describe("nextCursor", () => {
  const keysOf = (item: { readonly id: string }) => [item.id]

  it("is null when the page was not full, which is the end of the collection", () => {
    expect(nextCursor([{ id: "a" }, { id: "b" }], 50, keysOf)).toBeNull()
  })

  it("is the last row's key when the page was full", () => {
    expect(nextCursor([{ id: "a" }, { id: "b" }], 2, keysOf)).toBe(encodeCursor(["b"]))
  })

  /*
   * A full page yields a cursor even when it happens to be the last one, so a client may make one final
   * request that returns nothing. That is the contract, not a bug: the alternative is querying `limit + 1` on
   * every page to find out, which pays on every request to save one at the end.
   */
  it("still yields a cursor for a full FINAL page", () => {
    expect(nextCursor([{ id: "a" }], 1, keysOf)).toBe(encodeCursor(["a"]))
  })

  it("is null for an empty page", () => {
    expect(nextCursor([], 50, keysOf)).toBeNull()
  })
})
