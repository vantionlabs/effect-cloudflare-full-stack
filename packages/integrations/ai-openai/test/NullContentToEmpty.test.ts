/**
 * The one rewrite this adapter makes, pinned so it neither disappears nor widens.
 *
 * Workers AI refuses an assistant turn with `content: null` — the shape OpenAI's protocol sends for a turn that only
 * calls tools — and accepts the identical request with `""` (bisected against Workers AI directly, 2026-10-01).
 * Without the rewrite the ask loop failed on its SECOND model call, every time, in every environment.
 */
import { nullContentToEmpty } from "@ea/ai-openai/Model"
import { describe, expect, it } from "vitest"

const toolTurn = {
  role: "assistant",
  content: null,
  tool_calls: [{ id: "call_1", type: "function", function: { name: "search_policy", arguments: "{}" } }]
}

describe("nullContentToEmpty", () => {
  it("gives an assistant tool-call turn an empty string, keeping its tool calls", () => {
    const out = nullContentToEmpty({ model: "m", messages: [{ role: "user", content: "q" }, toolTurn] }) as {
      messages: Array<Record<string, unknown>>
    }
    expect(out.messages[1]).toEqual({ ...toolTurn, content: "" })
  })

  it("leaves every other message, and every other field, exactly as it was", () => {
    const body = {
      model: "m",
      tool_choice: "auto",
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "q" },
        { role: "tool", tool_call_id: "call_1", content: "{}" },
        { role: "assistant", content: "an answer" }
      ]
    }
    expect(nullContentToEmpty(body)).toEqual(body)
  })

  it("passes through anything that is not a chat request", () => {
    expect(nullContentToEmpty({ input: "embeddings" })).toEqual({ input: "embeddings" })
    expect(nullContentToEmpty(null)).toBeNull()
  })
})
