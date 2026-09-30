/**
 * The published contract, frozen as a committed file.
 *
 * **Why this exists.** ADR-0012's guarantee is that a domain rename cannot break a client we do not control.
 * That used to be enforced by hand-writing every wire type, which was expensive and checked by nothing;
 * `Wire.ts` now DERIVES the snake_case names from the domain fields, which is cheaper and means a domain rename
 * can reach the wire. This file is what makes that safe: the generated OpenAPI document is committed, so a
 * rename fails here with a diff naming the field, and publishing it becomes a deliberate act.
 *
 * **When it fails, read the diff before updating it.** The question is never "is the snapshot stale" but "is
 * this change one a v1 client can survive". Adding a field is safe. Renaming or removing one is a breaking
 * change to a frozen contract, and the answer is usually a v2 endpoint rather than a new snapshot.
 *
 * Update deliberately with `bun run test -u` once the diff has been read.
 */
import { OpenApi } from "effect/http-api"
import { describe, expect, it } from "vitest"
import { ApiV1 } from "../src/v1/index.ts"

describe("the v1 OpenAPI document", () => {
  it("matches the committed contract", async () => {
    // Serialised with two-space indentation so the failure diff is per line rather than one long string.
    await expect(JSON.stringify(OpenApi.fromApi(ApiV1), null, 2) + "\n")
      .toMatchFileSnapshot("./fixtures/openapi.v1.json")
  })
})
