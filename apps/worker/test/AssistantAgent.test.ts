/**
 * The agent's state survives a request, and a bad turn cannot get into it.
 *
 * Both claims need real `workerd`: state persistence is the Durable Object's, and `validateStateChange` is
 * called by the SDK rather than by us, so a unit test would be asserting our own call. The pure part — the
 * append and the turn bound — is tested without any of this in
 * `packages/modules/src/policy/domain/test/Assistant.test.ts`, which is the same split rooms use.
 *
 * Gated with the rest of the `worker` project: it boots a real `workerd`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestHarness } from "wrangler"

let server: ReturnType<typeof createTestHarness>

beforeAll(async () => {
  server = createTestHarness({
    workers: [{
      configPath: new URL("./fixtures/assistant-agent/wrangler.jsonc", import.meta.url).pathname
    }]
  })
  await server.listen()
}, 120_000)

afterAll(async () => {
  await server?.close()
})

interface Conversation {
  readonly turns: ReadonlyArray<{ readonly question: string; readonly answer?: string }>
}

const turn = (question: string) => ({
  question,
  answer: `an answer to ${question}`,
  citations: ["chunk-1"],
  askedAt: "2026-09-30T00:00:00.000Z"
})

const post = (name: string, body: unknown) =>
  server.fetch(`/?name=${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  })

const get = async (name: string): Promise<Conversation> =>
  await (await server.fetch(`/?name=${name}`)).json() as Conversation

describe("an assistant's conversation", () => {
  it("starts empty", async () => {
    expect((await get("fresh")).turns).toEqual([])
  })

  it("remembers a turn across separate requests", async () => {
    // The whole reason this is an agent rather than a function: the second request is a different
    // invocation, and the first one's state is still there.
    expect((await post("memory", turn("which clause covers a supplier not on the list?"))).status).toBe(200)
    const conversation = await get("memory")
    expect(conversation.turns).toHaveLength(1)
    expect(conversation.turns[0]!.question).toBe("which clause covers a supplier not on the list?")
  })

  it("keeps two conversations apart", async () => {
    /*
     * One name is one instance (ADR-0018). This is the property the tenancy note on the `ASSISTANTS`
     * binding depends on — and the reason a conversation id must carry an organization component, since the
     * isolation is by NAME and nothing else.
     */
    await post("alice", turn("alice's question"))
    await post("bob", turn("bob's question"))
    expect((await get("alice")).turns).toHaveLength(1)
    expect((await get("alice")).turns[0]!.question).toBe("alice's question")
    expect((await get("bob")).turns[0]!.question).toBe("bob's question")
  })

  it("records a refusal as a turn, with no answer", async () => {
    // A refusal is the product working, so it is kept with the same weight as an answer.
    const refused = {
      question: "what does clause 99 say?",
      refusedBecause: "no clause in the corpus supports this",
      citations: [],
      askedAt: "2026-09-30T00:00:00.000Z"
    }
    expect((await post("refusal", refused)).status).toBe(200)
    const conversation = await get("refusal")
    expect(conversation.turns[0]!.answer).toBeUndefined()
  })

  it("refuses a turn that is not a turn, with 400 and a reason", async () => {
    // The only caller is our own Worker, so this is a bug in it — and an opaque 500 would not say which
    // field was wrong.
    const response = await post("invalid", { question: 42 })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain("error")
  })

  it("does not append the invalid turn it refused", async () => {
    expect((await get("invalid")).turns).toEqual([])
  })
})
