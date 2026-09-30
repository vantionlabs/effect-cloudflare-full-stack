/**
 * A `LanguageModel` that answers from a script.
 *
 * **Ships in `server/`, not in a test folder, on purpose:** `wrangler dev` with no API key should run
 * the whole pipeline. A contributor who cannot reach a provider can still upload a fixture and watch
 * a decision reach the review queue, and the adversarial scripts below are product behaviour rather
 * than incidental tests.
 *
 * It is short because structured output is JSON-in-text: `generateObject` sets
 * `responseFormat: { type: "json" }` with `toolChoice: "none"`, then decodes the concatenated text
 * parts. So a scripted model returns one text part containing JSON and the real decode path runs
 * unchanged — schema errors, span checks and all.
 *
 * **It dies on a script miss** rather than returning a default. A test that silently receives a
 * generic answer passes for the wrong reason, and that is worse than no test: it reports confidence
 * about a path nobody exercised.
 */
import { Effect, Layer, Stream } from "effect"
import { LanguageModel } from "effect/ai"

export interface Script {
  /**
   * Returns the JSON the model should answer with, or `undefined` to signal no match.
   *
   * Receives the fully rendered prompt, so a script can key on anything in the document — which is
   * how the adversarial cases pick themselves.
   */
  readonly respond: (prompt: string) => unknown | undefined
  /** Named in the defect when nothing matches, so the failure says which script was in play. */
  readonly name: string
}

/** Builds a script from substring matches. The common case, and it keeps fixtures declarative. */
export const scriptFrom = (
  name: string,
  cases: ReadonlyArray<{ readonly when: string; readonly answer: unknown }>
): Script => ({
  name,
  respond: (prompt) => cases.find((entry) => prompt.includes(entry.when))?.answer
})

/** Serialises the prompt the way `generateText` receives it, for substring matching. */
const renderPrompt = (prompt: unknown): string => JSON.stringify(prompt)

export const LanguageModelScripted = (script: Script): Layer.Layer<LanguageModel.LanguageModel> =>
  Layer.effect(LanguageModel.LanguageModel)(
    LanguageModel.make({
      generateText: (options) =>
        Effect.sync(() => {
          const answer = script.respond(renderPrompt(options.prompt))
          if (answer === undefined) {
            // A defect, not a failure: no production code should ever handle "the fake had no
            // answer", and making it catchable would let a test swallow it.
            throw new Error(
              `script "${script.name}" has no answer for this prompt. Add a case rather than ` +
                `loosening the match — a scripted model that falls back to a default makes every ` +
                `test that hits it pass for the wrong reason.\n\n` +
                renderPrompt(options.prompt).slice(0, 600)
            )
          }
          return [{ type: "text" as const, text: JSON.stringify(answer) }]
        }),
      // Nothing in this product streams. An empty stream would silently produce an empty answer, so
      // reaching for it is a defect too.
      streamText: () => Stream.die(new Error(`script "${script.name}" does not stream; this pipeline never streams`))
    })
  )
