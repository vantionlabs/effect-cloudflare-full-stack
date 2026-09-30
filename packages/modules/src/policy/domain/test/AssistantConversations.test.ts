/**
 * The tenancy boundary, which is a string join and a regex — and is therefore worth testing precisely
 * because it looks too small to break.
 *
 * If `conversationName` ever stopped including the organization, nothing would fail. Every conversation
 * would simply become shared, and it would present as a feature until somebody read another organization's
 * questions. There is no runtime error to catch, no log line, and the Durable Object cannot notice: it
 * cannot validate the identity it is handed (ADR-0025). These assertions are the whole defence.
 */
import { ConversationId, conversationName, SEPARATOR } from "@ea/modules/policy/domain/Assistant"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const decode = Schema.decodeUnknownResult(ConversationId)

describe("conversationName", () => {
  it("includes the organization", () => {
    expect(conversationName("org-a", "conv-1")).toBe(`org-a${SEPARATOR}conv-1`)
  })

  it("gives two organizations different names for the same conversation id", () => {
    // The property the whole design rests on: the id is client-chosen, so it is NOT the isolator.
    expect(conversationName("org-a", "shared")).not.toBe(conversationName("org-b", "shared"))
  })
})

describe("ConversationId", () => {
  it("accepts an opaque url-safe id", () => {
    for (const id of ["a", "conv-1", "AbC_123-xyz", "a".repeat(64)]) {
      expect(decode(id)._tag, id).toBe("Success")
    }
  })

  it("rejects an id containing the separator, which is the forgery this prevents", () => {
    /*
     * Without this, `org-b:conv-1` as an id under org-a would produce the name `org-a:org-b:conv-1` — and
     * while that is not literally org-b's name, an id free to contain the separator is one segment away from
     * addressing another tenant, and the guarantee stops being a guarantee and becomes an arithmetic
     * accident. Excluding the separator makes the join unambiguous, which is the actual property.
     */
    expect(decode(`org-b${SEPARATOR}conv-1`)._tag).toBe("Failure")
  })

  it("rejects the shapes a name could otherwise be smuggled through", () => {
    for (const id of ["", "a".repeat(65), "with space", "with/slash", "with.dot", "../escape", "emoji-🙂"]) {
      expect(decode(id)._tag, id).toBe("Failure")
    }
  })
})
