/**
 * The agent loop, driven by a scripted model. No network, no key, no database.
 *
 * What is worth testing here is **not** whether the model gives good answers — that is an eval, and it needs
 * a real model. It is the loop's own behaviour, which is where the expensive mistakes live: an unbounded loop
 * is an unbounded bill, and a tenant the model can influence is a cross-tenant read.
 */
import { CurrentOrg, OrgId } from "@ea/domain/Identity"
import { AgentModel, AskProgress } from "@ea/modules/policy/domain/Ask"
import { AskCorpus, AskCorpusStream, AskToolkit, askToolkitFor, AskToolkitLive } from "@ea/modules/policy/use-cases/Ask"
import { PolicySearch, type Retrieval } from "@ea/modules/shared/domain/Retrieval"
import { Effect, Layer, Schema, Stream } from "effect"
import { LanguageModel } from "effect/ai"
import { describe, expect, it } from "vitest"

const ORG = OrgId.make("ask_org")

/** Records what the tool was asked for, so the test can assert on the tenant rather than trust it. */
const recordingSearch = () => {
  const queries: Array<string> = []
  let searchedOrg: string | null = null
  const layer = Layer.succeed(PolicySearch)({
    search: (input) =>
      Effect.flatMap(CurrentOrg, (orgId) =>
        Effect.sync(() => {
          queries.push(input.query)
          searchedOrg = orgId
          return {
            mode: "hybrid",
            chunks: [{
              chunk_id: "c1",
              document_id: "d1",
              heading: "Artikel 4 Goedgekeurde leveranciers",
              clause_ref: "Artikel 4",
              content: "Een factuur van een leverancier die niet op de lijst staat wordt doorgestuurd.",
              score: 1,
              semantic_rank: 1,
              lexical_rank: 1
            }]
          } as unknown as Retrieval
        }))
  })
  return { queries, layer, org: () => searchedOrg }
}

/**
 * A model that calls the tool `toolCalls` times and then answers.
 *
 * Counts its own invocations, because the property under test is how many times the LOOP called the model —
 * and asking the loop to report that would be the thing under test vouching for itself.
 *
 * The final call is answered with **JSON**, because the loop now ends in `generateObject`: the citations have to
 * be addressable to be checkable. `generateObject` is derived from `generateText` and decodes the concatenated
 * text parts, which is why a scripted model needs no extra method — the same mechanism `ExtractDocument`'s tests
 * rely on.
 */
const scripted = (options: {
  readonly toolCalls: number
  readonly answer: string
  readonly citations?: ReadonlyArray<{ chunk_id: string; clause_ref: string | null; excerpt: string }>
}) => {
  const calls = { model: 0 }
  // Provided under `AgentModel`, the tag `AskCorpus` actually requires — see `AgentModel.ts`. The test names
  // the same requirement production does, so a composition root that provided only the decide pipeline's
  // model would fail here too rather than only in the Worker.
  const layer = Layer.effect(AgentModel)(
    LanguageModel.make({
      generateText: () =>
        Effect.sync(() => {
          calls.model++
          if (calls.model <= options.toolCalls) {
            return [{
              type: "tool-call" as const,
              id: `call_${calls.model}`,
              name: "search_policy",
              params: { query: `zoekterm ${calls.model}` }
            }]
          }
          /*
           * After the tool calls, two things are returned in sequence: a text part (which ends the loop) and
           * then the JSON the structured pass decodes. The loop asks twice, so the counter distinguishes them.
           */
          if (calls.model === options.toolCalls + 1) {
            return [{ type: "text" as const, text: options.answer }]
          }
          return [{
            type: "text" as const,
            text: JSON.stringify({ citations: options.citations ?? [], answer: options.answer })
          }]
        }),
      streamText: () => Stream.die(new Error("not used"))
    })
  )
  return { calls, layer }
}

const run = (model: Layer.Layer<AgentModel>, search: Layer.Layer<PolicySearch>) =>
  Effect.runPromise(
    AskCorpus("Mag ik een factuur van een onbekende leverancier goedkeuren?").pipe(
      // One provide: `AskToolkitLive` requires `PolicySearch` and `CurrentOrg`, so this is
      // `provideMerge` rather than a second chained provide (`multipleEffectProvide`).
      Effect.provide(
        AskToolkitLive.pipe(
          Layer.provideMerge(Layer.mergeAll(model, search, Layer.succeed(CurrentOrg)(ORG)))
        )
      ),
      // A refusal or provider error is a failed test here; `refusalOf` below is for the tests that expect one.
      Effect.orDie
    )
  )

/** The failure a refused answer produced, as a value. `Effect.flip`, for the reason in AGENTS.md. */
const refusalOf = (model: Layer.Layer<AgentModel>, search: Layer.Layer<PolicySearch>) =>
  Effect.runPromise(
    Effect.flip(
      AskCorpus("Mag ik een factuur van een onbekende leverancier goedkeuren?").pipe(
        Effect.provide(
          AskToolkitLive.pipe(
            Layer.provideMerge(Layer.mergeAll(model, search, Layer.succeed(CurrentOrg)(ORG)))
          )
        )
      )
    ) as unknown as Effect.Effect<{ _tag: string; reasons: ReadonlyArray<string> }, never, never>
  )

describe("the loop", () => {
  it("searches, then answers", async () => {
    const search = recordingSearch()
    const model = scripted({ toolCalls: 1, answer: "Nee — Artikel 4 stuurt die factuur naar de inkoopafdeling." })
    const result = await run(model.layer, search.layer)

    expect(result.truncated).toBe(false)
    expect(result.answer).toContain("Artikel 4")
    expect(search.queries).toEqual(["zoekterm 1"])
    /*
     * THREE model calls, and the third is the price of checkable citations: one that asked for the tool, one
     * that answered with its result, and one structured pass that renders the answer with addressable
     * citations. It was two before the grounding check existed.
     *
     * `steps` is still 2, and the difference is deliberate: `steps` counts loop iterations — how many times the
     * model went looking — which is what a reviewer reads and what `MAX_STEPS` bounds. The structured pass is
     * not another search.
     */
    expect(model.calls.model).toBe(3)
    expect(result.steps).toBe(2)
  })

  it("answers without searching, when it chooses to", async () => {
    // Not encouraged by the prompt, but the loop must not require a tool call — a model that already has the
    // answer in context should be able to say so rather than being forced into a paid round trip.
    const search = recordingSearch()
    const result = await run(scripted({ toolCalls: 0, answer: "Dat staat niet in het beleid." }).layer, search.layer)
    expect(result.steps).toBe(1)
    expect(search.queries).toEqual([])
  })

  it("STOPS at the bound, and says the answer is truncated", async () => {
    /*
     * The expensive failure. A model whose tool results never satisfy it will call forever, and every call is
     * paid for. `MAX_STEPS` is a hard stop rather than a safety net, and `truncated` exists so that hitting it
     * is visible: without it a bounded loop returns whatever text it happens to have and reads like a normal,
     * slightly worse answer.
     */
    const search = recordingSearch()
    const model = scripted({ toolCalls: 99, answer: "never reached" })
    const result = await run(model.layer, search.layer)

    expect(result.truncated).toBe(true)
    expect(result.answer).toBe("")
    // Bounded: 4 model calls and 4 searches, not 99.
    expect(model.calls.model).toBe(4)
    expect(search.queries.length).toBe(4)
  })
})

describe("the tenant", () => {
  it("is the one captured at layer build, not one the model could influence", async () => {
    /*
     * The security-relevant property. The MODEL chooses the query text, so the query is attacker-influenced
     * whenever a document is — and a document is attacker-controlled by definition here. The organization is
     * captured when `AskToolkitLive` is built and provided to the handler from that closure, so no prompt can
     * redirect the search. If this ever reads anything but `ORG`, the tool has started taking the tenant from
     * its arguments.
     */
    const search = recordingSearch()
    await run(scripted({ toolCalls: 1, answer: "ok" }).layer, search.layer)
    expect(search.org()).toBe(ORG)
  })

  it("offers exactly one tool, and it is read-only", async () => {
    // The whole safety argument: the agent's blast radius is the tool list. Retrieval and nothing else — no
    // approve, no execute, no write. A second tool here is a decision someone has to defend.
    expect(Object.keys(AskToolkit.tools)).toEqual(["search_policy"])
  })
})

/**
 * The rails, on the chat surface.
 *
 * **This is the reason the loop ends in a structured pass.** The decide path refuses a decision whose excerpt is
 * not verbatim in the cited chunk, and refuses a citation to a chunk that was never retrieved. An agent that can
 * put either in front of the same reviewer is the way around those rails — and it is the surface that reads most
 * like a conversation and least like a claim, which is what makes it dangerous rather than merely inconsistent.
 *
 * The clause the recording search serves is `c1` / `Artikel 4`, with the content asserted below.
 */
describe("grounding", () => {
  const RETRIEVED = "Een factuur van een leverancier die niet op de lijst staat wordt doorgestuurd."

  it("returns a correctly cited answer, with its citations", async () => {
    const search = recordingSearch()
    const result = await run(
      scripted({
        toolCalls: 1,
        answer: "Nee — Artikel 4 stuurt die factuur door.",
        citations: [{ chunk_id: "c1", clause_ref: "Artikel 4", excerpt: RETRIEVED }]
      }).layer,
      search.layer
    )

    expect(result.citations).toHaveLength(1)
    expect(result.citations[0]!.chunk_id).toBe("c1")
  })

  it("says WHERE a citation is from, using what the search returned — not the model's own label", async () => {
    /*
     * The model calls the clause "Artikel 99"; the search served chunk c1 under the heading "Artikel 4 …" from
     * "inkoopbeleid.md". The located citation keeps the model's clause_ref (it is what the model said) but takes
     * heading and document from the search, because a model that can mislabel a quote must not label its source.
     */
    const search = Layer.succeed(PolicySearch)({
      search: () =>
        Effect.succeed({
          mode: "hybrid",
          chunks: [{
            chunk_id: "c1",
            document_id: "d1",
            document_title: "inkoopbeleid.md",
            heading: "Artikel 4 Goedgekeurde leveranciers",
            clause_ref: "Artikel 4",
            content: "Een factuur van een leverancier die niet op de lijst staat wordt doorgestuurd.",
            score: 1,
            semantic_rank: 1,
            lexical_rank: 1
          }]
        } as unknown as Retrieval)
    })
    const result = await run(
      scripted({
        toolCalls: 1,
        answer: "Nee.",
        citations: [{ chunk_id: "c1", clause_ref: "Artikel 99", excerpt: RETRIEVED }]
      }).layer,
      search
    )
    expect(result.citations[0]).toMatchObject({
      chunk_id: "c1",
      clause_ref: "Artikel 99",
      heading: "Artikel 4 Goedgekeurde leveranciers",
      document: "inkoopbeleid.md"
    })
  })

  /*
   * The assertion issue 06 named. A clause reference is text a model can invent and have look plausible; a
   * chunk id is a value it can only have seen by calling the tool. So the check is on the id.
   */
  it("REFUSES a citation to a chunk that was never retrieved", async () => {
    const search = recordingSearch()
    const failure = await refusalOf(
      scripted({
        toolCalls: 1,
        answer: "Artikel 9 verbiedt dit.",
        citations: [{ chunk_id: "c-invented", clause_ref: "Artikel 9", excerpt: "Dit is verboden." }]
      }).layer,
      search.layer
    )

    expect(failure._tag).toBe("UngroundedAnswer")
    // The reason names the chunk AND how it was cited, so the refusal is actionable rather than a shrug.
    expect(failure.reasons[0]).toContain("c-invented")
    expect(failure.reasons[0]).toContain("Artikel 9")
  })

  it("REFUSES an excerpt that is not verbatim in the clause it cites", async () => {
    const search = recordingSearch()
    const failure = await refusalOf(
      scripted({
        toolCalls: 1,
        answer: "Artikel 4 zegt dat het mag.",
        // The chunk is real; the quote is not. This is the subtler half, and the more likely one: a model
        // paraphrasing a clause it did retrieve, into something the clause does not say.
        citations: [{ chunk_id: "c1", clause_ref: "Artikel 4", excerpt: "wordt goedgekeurd zonder controle" }]
      }).layer,
      search.layer
    )

    expect(failure._tag).toBe("UngroundedAnswer")
    expect(failure.reasons[0]).toContain("not verbatim")
    expect(failure.reasons[0]).toContain("Artikel 4")
  })

  it("names EVERY failure, not just the first", async () => {
    // Same reasoning as the rails firing once per unmet bound: a reviewer should see every reason, because
    // fixing one and rediscovering the next is how a prompt gets tuned in circles.
    const search = recordingSearch()
    const failure = await refusalOf(
      scripted({
        toolCalls: 1,
        answer: "x",
        citations: [
          { chunk_id: "nope", clause_ref: "Artikel 8", excerpt: RETRIEVED },
          { chunk_id: "c1", clause_ref: "Artikel 4", excerpt: "iets anders" }
        ]
      }).layer,
      search.layer
    )

    expect(failure.reasons).toHaveLength(2)
  })

  /*
   * An answer with no citations is ALLOWED, and the prompt asks for it: "if the corpus does not settle the
   * question, say so and say what is missing. That is a correct answer." Refusing here would make the honest
   * outcome indistinguishable from the dishonest one.
   */
  it("allows an uncited answer, because declining is a correct answer", async () => {
    const search = recordingSearch()
    const result = await run(
      scripted({ toolCalls: 1, answer: "Het beleid zegt hier niets over.", citations: [] }).layer,
      search.layer
    )

    expect(result.citations).toEqual([])
    expect(result.answer).toContain("niets")
  })

  it("tolerates re-wrapped whitespace, and nothing else", async () => {
    // The same normalisation the rails and the console's highlighting use: a model that re-wrapped a line has
    // not invented anything, while a changed digit or symbol is exactly what is worth lying about.
    const search = recordingSearch()
    const result = await run(
      scripted({
        toolCalls: 1,
        answer: "ok",
        citations: [{
          chunk_id: "c1",
          clause_ref: "Artikel 4",
          excerpt: "Een factuur van een leverancier\n  die niet op de lijst staat\nwordt doorgestuurd."
        }]
      }).layer,
      search.layer
    )

    expect(result.citations).toHaveLength(1)
  })

  it("does not accept a clause retrieved for a DIFFERENT question", async () => {
    /*
     * `served` is scoped to this question's searches, which is what makes "was retrieved" mean anything. A
     * corpus-wide check would pass any real clause, including one the model went looking for after deciding
     * its answer — the failure rail 2 was written for.
     */
    const search = recordingSearch()
    const failure = await refusalOf(
      // No tool call at all, so nothing was served: even a REAL chunk id cannot be cited.
      scripted({
        toolCalls: 0,
        answer: "Artikel 4 zegt het.",
        citations: [{ chunk_id: "c1", clause_ref: "Artikel 4", excerpt: RETRIEVED }]
      }).layer,
      search.layer
    )

    expect(failure._tag).toBe("UngroundedAnswer")
    expect(search.queries).toEqual([])
  })
})

/**
 * The stream, and what it deliberately does NOT carry.
 *
 * `AskCorpusStream` reports each search and then the finished answer. It does not stream the answer's prose,
 * and that is the design rather than an omission: the citations are only checkable once the answer is complete,
 * so streaming text first means an unverifiable claim has been read by the time it is refused. A retraction
 * after the fact is not a refusal — the reviewer has already seen it.
 */
describe("the progress stream", () => {
  const RETRIEVED = "Een factuur van een leverancier die niet op de lijst staat wordt doorgestuurd."

  const collect = (model: Layer.Layer<AgentModel>, search: Layer.Layer<PolicySearch>) =>
    Effect.runPromise(
      Stream.runCollect(
        AskCorpusStream("Mag ik een factuur van een onbekende leverancier goedkeuren?").pipe(
          Stream.provide(
            AskToolkitLive.pipe(
              Layer.provideMerge(Layer.mergeAll(model, search, Layer.succeed(CurrentOrg)(ORG)))
            )
          )
        )
      ) as unknown as Effect.Effect<
        ReadonlyArray<{ _tag: string; query?: string; citations?: ReadonlyArray<unknown> }>
      >
    )

  it("reports each search, then the finished answer", async () => {
    const search = recordingSearch()
    const frames = await collect(
      scripted({
        toolCalls: 2,
        answer: "Nee — Artikel 4 stuurt die factuur door.",
        citations: [{ chunk_id: "c1", clause_ref: "Artikel 4", excerpt: RETRIEVED }]
      }).layer,
      search.layer
    )

    expect(frames.map((frame) => frame._tag)).toEqual(["Searching", "Searching", "Answered"])
    // The model's own query text, which is the useful part of waiting.
    expect(frames[0]!.query).toBe("zoekterm 1")
    expect(frames[2]!.citations).toHaveLength(1)
  })

  /*
   * The property the whole design rests on. A refused answer must emit NO `Answered` frame — if it did, the
   * unverifiable claim would have been delivered and the refusal would be decoration.
   */
  it("emits NO answer frame when the citations cannot be verified", async () => {
    const search = recordingSearch()
    const frames = await Effect.runPromise(
      Stream.runCollect(
        AskCorpusStream("vraag").pipe(
          Stream.provide(
            AskToolkitLive.pipe(
              Layer.provideMerge(Layer.mergeAll(
                scripted({
                  toolCalls: 1,
                  answer: "Artikel 9 verbiedt dit.",
                  citations: [{ chunk_id: "c-invented", clause_ref: "Artikel 9", excerpt: "Dit is verboden." }]
                }).layer,
                search.layer,
                Layer.succeed(CurrentOrg)(ORG)
              ))
            )
          ),
          // The stream FAILS rather than completing, so the collect below would reject without this.
          Stream.catchTag("UngroundedAnswer", () => Stream.empty)
        )
      ) as unknown as Effect.Effect<ReadonlyArray<{ _tag: string }>>
    )

    // The search was reported — that happened — and the answer never arrives.
    expect(frames.map((frame) => frame._tag)).toEqual(["Searching"])
  })

  it("carries no token or chunk frame at all", () => {
    // Asserted by DECODING, so adding a prose frame is a deliberate act that fails here first. Streaming the
    // answer's text is what would reopen the bypass this whole design exists to close.
    expect(() => Schema.decodeUnknownSync(AskProgress)({ _tag: "Token", text: "Nee" })).toThrow()
    expect(() => Schema.decodeUnknownSync(AskProgress)({ _tag: "Chunk", text: "Nee" })).toThrow()
    // And the two that do exist still decode, so the assertion above is not passing for the wrong reason.
    expect(Schema.decodeSync(AskProgress)({ _tag: "Searching", query: "x", retrieval_mode: null }))
      .toBeDefined()
  })
})

describe("asking the technical documentation", () => {
  /*
   * The collection is decided at the EDGE and closed over by the toolkit, exactly like the tenant: the model picks
   * query text and nothing else. These pin that a `knowledge` question searches `knowledge` — not the policy
   * corpus invoice decisions are justified against — and that it is asked under the mechanics' rules.
   */
  const askKnowledge = () => {
    const searched: Array<string | undefined> = []
    const prompts: Array<string> = []
    const search = Layer.succeed(PolicySearch)({
      search: (input) =>
        Effect.sync(() => {
          searched.push(input.collection)
          return { mode: "hybrid", chunks: [] } as unknown as Retrieval
        })
    })
    let call = 0
    const model = Layer.effect(AgentModel)(
      LanguageModel.make({
        generateText: (options) =>
          Effect.sync(() => {
            call++
            prompts.push(JSON.stringify(options.prompt))
            if (call === 1) {
              return [{ type: "tool-call" as const, id: "c1", name: "search_policy", params: { query: "werkdruk" } }]
            }
            if (call === 2) return [{ type: "text" as const, text: "De documentatie noemt geen werkdruk." }]
            return [{
              type: "text" as const,
              text: JSON.stringify({ citations: [], answer: "De documentatie noemt geen werkdruk." })
            }]
          }),
        streamText: () => Stream.die(new Error("not used"))
      })
    )
    const result = Effect.runPromise(
      AskCorpus("Wat is de maximale werkdruk?", "knowledge").pipe(
        Effect.provide(
          askToolkitFor("knowledge").pipe(
            Layer.provideMerge(Layer.mergeAll(model, search, Layer.succeed(CurrentOrg)(ORG)))
          )
        ),
        // A refusal or provider error would be a test failure, not a value this test inspects.
        Effect.orDie
      )
    )
    return { result, searched, prompts }
  }

  it("searches the knowledge collection, never the policy corpus", async () => {
    const { result, searched } = askKnowledge()
    await result
    expect(searched).toEqual(["knowledge"])
  })

  it("is asked under the mechanics' rules, including never stating an unquoted value", async () => {
    const { result, prompts } = askKnowledge()
    await result
    expect(prompts[0]).toContain("mechanics in a workshop")
    expect(prompts[0]).toContain("NEVER state a value")
    expect(prompts[0]).not.toContain("procurement policy")
  })
})
