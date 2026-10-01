/**
 * The conversation's own rules, with no agent, no Durable Object and no `workerd`.
 *
 * The same split `@ea/realtime/Server` makes for rooms: what a conversation *is* is a pure function over an
 * encoded value, so it is tested here in milliseconds, and `apps/worker/test/AssistantAgent.test.ts` is left
 * to assert only what genuinely needs the platform — that state survives a request.
 */
import {
  appendTurn,
  AssistantConversation,
  AssistantTurn,
  emptyConversation,
  MAX_TURNS
} from "@ea/modules/policy/domain/Assistant"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const turn = (question: string): typeof AssistantTurn.Encoded => ({
  question,
  answer: "an answer",
  citations: ["chunk-1"],
  askedAt: "2026-09-30T00:00:00.000Z"
})

describe("appendTurn", () => {
  it("appends in order", () => {
    const conversation = appendTurn(appendTurn(emptyConversation, turn("first")), turn("second"))
    expect(conversation.turns.map((t) => t.question)).toEqual(["first", "second"])
  })

  it("does not mutate the conversation it was given", () => {
    // The agent reads `this.state` and writes a new one through `setState`; mutating in place would
    // update the object without telling the SDK, so nothing would be persisted or synced to a client.
    const before = appendTurn(emptyConversation, turn("first"))
    appendTurn(before, turn("second"))
    expect(before.turns).toHaveLength(1)
  })

  it("keeps the most recent MAX_TURNS and drops the oldest", () => {
    /*
     * The bound matters because Durable Object state is read and written WHOLE — an unbounded conversation
     * makes every message more expensive than the last, and degrades rather than failing. Dropping is safe
     * because the answers themselves are rows in Postgres.
     */
    let conversation = emptyConversation
    for (let index = 0; index < MAX_TURNS + 10; index = index + 1) {
      conversation = appendTurn(conversation, turn(`q${index}`))
    }
    expect(conversation.turns).toHaveLength(MAX_TURNS)
    expect(conversation.turns[0]!.question).toBe("q10")
    expect(conversation.turns.at(-1)!.question).toBe(`q${MAX_TURNS + 9}`)
  })
})

describe("the turn schema", () => {
  const decode = Schema.decodeUnknownResult(AssistantTurn)

  it("accepts a refusal, which has no answer", () => {
    const result = decode({
      question: "what does clause 99 say?",
      refusedBecause: "no clause in the corpus supports this",
      citations: [],
      askedAt: "2026-09-30T00:00:00.000Z"
    })
    expect(result._tag).toBe("Success")
  })

  it("rejects a turn whose question is not a string", () => {
    expect(decode({ question: 42, citations: [], askedAt: "x" })._tag).toBe("Failure")
  })

  it("rejects citations that are not strings, because a chunk id is what the console resolves", () => {
    expect(decode({ question: "q", citations: [{ id: 1 }], askedAt: "x" })._tag).toBe("Failure")
  })
})

describe("the conversation schema", () => {
  it("accepts the empty conversation the agent starts from", () => {
    expect(Schema.decodeResult(AssistantConversation)(emptyConversation)._tag).toBe("Success")
  })
})
