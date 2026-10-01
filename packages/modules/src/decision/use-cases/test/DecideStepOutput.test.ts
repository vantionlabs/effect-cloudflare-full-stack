/**
 * `decideStepOutput` reads a memoised Decide result in either shape.
 *
 * Workflow step results are stored, so an instance that finished `Decide` before the step started returning the
 * model replays the OLD shape — the bare proposal — into the new `Settle`. Both must settle, and the old one must
 * say the model was not recorded rather than inherit a guess.
 */
import { decideStepOutput } from "@ea/modules/decision/use-cases/Decision"
import { describe, expect, it } from "vitest"

const proposal = { outcome: "route_for_approval", citations: [], rationale: "r" }

describe("decideStepOutput", () => {
  it("reads the current shape as it is", () => {
    expect(decideStepOutput({ proposal, model: "@cf/meta/llama" })).toEqual({ proposal, model: "@cf/meta/llama" })
  })

  it("reads a pre-change memo — the bare proposal — as a proposal with no recorded model", () => {
    expect(decideStepOutput(proposal)).toEqual({ proposal, model: null })
  })
})
