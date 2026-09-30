/**
 * The embedder reaches AI Gateway on both transports — asserted, because its failure is silent.
 *
 * A missing gateway does not break anything. The call succeeds, returns correct vectors, and is simply
 * unmetered, unlogged and uncached. That is the worst shape a bug can have: nothing to notice, and the
 * only symptom is a bill and a neuron allocation that empties faster than it should. This adapter went
 * direct while the chat adapter one line away in `Main.ts` was routed, for exactly that reason.
 *
 * Lives in `domain/test` beside `LanguageModelWorkersAi.test.ts` and for the same reason: it needs
 * nothing — no token, no network, no bindings.
 */
import {
  EmbedderWorkersAiBinding,
  embedRequestHeaders,
  embedRunUrl,
  WORKERS_AI_EMBEDDING_MODEL
} from "@ea/modules/policy/server/Embedding"
import { Effect, Redacted } from "effect"
import { EmbeddingModel } from "effect/ai"
import { describe, expect, it } from "vitest"

const token = Redacted.make("tkn")

describe("the REST transport", () => {
  it("keeps the same /ai/run URL whether or not a gateway is configured", () => {
    /*
     * The documented asymmetry with the chat endpoint, asserted so a later reader does not "fix" it into
     * a `gateway.ai.cloudflare.com` host. Cloudflare: the `/ai/run/@cf/{model}` path continues to work,
     * and a Workers AI model is routed through a gateway by HEADER.
     */
    expect(embedRunUrl({ accountId: "acc" }))
      .toBe(`https://api.cloudflare.com/client/v4/accounts/acc/ai/run/${WORKERS_AI_EMBEDDING_MODEL}`)
  })

  it("sends cf-aig-gateway-id when a gateway is configured", () => {
    expect(embedRequestHeaders({ token, gateway: "gw" })["cf-aig-gateway-id"]).toBe("gw")
  })

  it("omits the header entirely when no gateway is configured", () => {
    // Omitted rather than sent empty: an empty gateway id is not a documented way to say "direct", and a
    // header whose value is "" is the kind of thing a proxy answers 400 to.
    const headers = embedRequestHeaders({ token, gateway: undefined })
    expect("cf-aig-gateway-id" in headers).toBe(false)
  })

  it("still authenticates and sets the content type in both cases", () => {
    for (const gateway of ["gw", undefined]) {
      const headers = embedRequestHeaders({ token, gateway })
      expect(headers.authorization).toBe("Bearer tkn")
      expect(headers["content-type"]).toBe("application/json")
    }
  })
})

describe("the binding transport", () => {
  /**
   * A fake binding that records the third argument.
   *
   * The run options are the whole subject here, so the double records them rather than asserting inline —
   * and it returns a shaped response because `checkWidth` rejects a width that disagrees with the column,
   * which would otherwise fail the test for an unrelated reason.
   */
  const recording = () => {
    const calls: Array<unknown> = []
    return {
      calls,
      run: (_model: string, _input: { readonly text: ReadonlyArray<string> }, options?: unknown) => {
        calls.push(options)
        return Promise.resolve({ shape: [1, 1024], data: [Array.from({ length: 1024 }, () => 0)] })
      }
    }
  }

  const embed = (binding: ReturnType<typeof recording>, gateway?: string) =>
    Effect.runPromise(
      Effect.flatMap(
        EmbeddingModel.EmbeddingModel,
        (model) => model.embedMany(["a chunk of policy text"])
      ).pipe(Effect.provide(EmbedderWorkersAiBinding(binding, gateway)))
    )

  it("passes the gateway as a run option", async () => {
    const binding = recording()
    await embed(binding, "gw")
    // `{ gateway: { id } }`, which is the only form the binding accepts — it cannot take a hostname.
    expect(binding.calls).toEqual([{ gateway: { id: "gw" } }])
  })

  it("passes undefined rather than an empty option when no gateway is configured", async () => {
    const binding = recording()
    await embed(binding)
    expect(binding.calls).toEqual([undefined])
  })

  it("still returns vectors of the column's width", async () => {
    // Guards the thing the gateway must not change: routing is a transport concern, and a routed call
    // must produce the same vectors as a direct one or the harness's numbers stop meaning anything.
    const binding = recording()
    const result = await embed(binding, "gw")
    expect(result.embeddings[0]!.vector.length).toBe(1024)
  })
})
