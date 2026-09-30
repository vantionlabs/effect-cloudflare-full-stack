/**
 * Our decide orchestration, in real `workerd`: the right steps are remembered and the rails are not.
 *
 * `WorkflowStepMemo.test.ts` proved the platform remembers a completed `step.do`. This proves we arranged
 * OURS so that the three expensive steps are the remembered ones and the rails-and-write half is not — which
 * is the property the migration exists for, and the one a reading of the code cannot settle.
 *
 * The work is faked and the class is real: the pipeline's logic has 11 tests against real Postgres in Node,
 * and running a model here would test the provider, spend neurons and make a memo assertion flaky. What is
 * platform-shaped is the orchestration, so that is what this exercises — imported from `src/`, so the step
 * names, the order, the retry policy and the short circuit are the deployed ones.
 *
 * Gated with the rest of the `worker` project: it boots a real `workerd`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestHarness } from "wrangler"

let server: ReturnType<typeof createTestHarness>

beforeAll(async () => {
  server = createTestHarness({
    workers: [{
      configPath: new URL("./fixtures/decide-workflow/wrangler.jsonc", import.meta.url).pathname
    }]
  })
  await server.listen()
}, 120_000)

afterAll(async () => {
  await server?.close()
})

interface Counts {
  readonly existing: number
  readonly parse: number
  readonly extract: number
  readonly retrieve: number
  readonly decide: number
  readonly settle: number
  readonly sc_existing: number
  readonly sc_extract: number
  readonly term_parse: number
  readonly retry_parse: number
}

const counts = async (): Promise<Counts> => await (await server.fetch("/counts")).json() as Counts

/** Starts an instance and polls until it settles. A fixed wait would either flake or be slow. */
const runToCompletion = async (which?: "short" | "terminal" | "retryable"): Promise<string> => {
  const query = which === undefined ? "" : `?which=${which}`
  const started = await server.fetch(`/start${query}`, { method: "POST" })
  expect(started.status).toBe(200)
  const { id } = await started.json() as { readonly id: string }

  const suffix = which === undefined ? "" : `&which=${which}`
  /*
   * 240 polls at 500 ms is a two-minute budget, and it is sized from the RETRY POLICY rather than guessed.
   *
   * `RETRIES` is production's — 5 attempts, exponential from 2 s — so a step that fails every time waits
   * 2 + 4 + 8 + 16 + 32 = 62 s before the instance errors. The first version allowed 60 s, which is under
   * that by two seconds: it passed locally and reported `timed out` in CI, where everything is a little
   * slower. A budget derived from the thing under test would have been right the first time.
   */
  for (let attempt = 0; attempt < 240; attempt = attempt + 1) {
    const body = await (await server.fetch(`/status?id=${id}${suffix}`)).json() as { readonly status: string }
    if (["complete", "errored", "terminated"].includes(body.status)) return body.status
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return "timed out"
}

describe("the decide orchestration", () => {
  let observed: Counts

  beforeAll(async () => {
    expect(await runToCompletion()).toBe("complete")
    observed = await counts()
  }, 120_000)

  it("runs each expensive step exactly once, although the instance retried", () => {
    /*
     * The assertion the whole migration rests on. `settle` throws on its first attempt — it is deliberately
     * NOT a `step.do` — so the instance retries and `run()` re-executes from the top. Extraction is the
     * expensive call (~€0.05), and with tier 3 configured `Parse` is a paid OCR call too; a second one here
     * would mean the memo is not protecting them and `WorkflowEnginePg` could not be deleted.
     */
    expect(observed.parse).toBe(1)
    expect(observed.extract).toBe(1)
    expect(observed.retrieve).toBe(1)
    expect(observed.decide).toBe(1)
  })

  it("retries the settle step on its own, without re-running the steps before it", () => {
    /*
     * `settle` throws once on purpose. It is a STEP, so it — and only it — is retried; the three before it
     * are already cached and must not run again. This is the shape the first version of this file got
     * wrong: settle ran outside any step, and the instance simply ERRORED with every counter at 1, because
     * an error outside a `step.do` is not retried at all.
     */
    expect(observed.settle).toBe(2)
  })

  it("checks for an existing decision exactly once, because run() does not re-execute", () => {
    /*
     * The measured fact that corrected the design. A step retry resumes at the failed step — it does not
     * re-enter `run()` — so the short circuit, which sits outside any step, runs once per INSTANCE and not
     * once per attempt. Anything that must happen on every attempt has to be inside a step.
     */
    expect(observed.existing).toBe(1)
  })
})

describe("the short circuit", () => {
  it("returns an existing decision without running a single step", async () => {
    /*
     * Strictly stronger than the memo, and strictly earlier: a memo saves re-running a step, this saves
     * entering the pipeline. The fixture's `extract` THROWS on this path, so if the early return were ever
     * removed this test would fail loudly rather than quietly costing a model call per redelivery.
     */
    expect(await runToCompletion("short")).toBe("complete")
    const observed = await counts()
    expect(observed.sc_existing).toBe(1)
    expect(observed.sc_extract).toBe(0)
  }, 120_000)
})

describe("the terminal-versus-retryable classification", () => {
  /*
   * ADR-0024's hardest loss, and the proof it was actually paid for rather than dropped.
   *
   * A step boundary is a `Promise`, so `Terminal.ts`'s typed union cannot cross it. `Main.ts` translates it
   * instead: the same `isTerminal` predicate the queue consumer uses decides whether to throw
   * `NonRetryableError` or a plain `Error`. If that translation were missing, everything would look
   * retryable and a `DocumentRowMissing` would cost five model-free-but-not-free attempts per document —
   * which is the mistake docket made and paid three model calls for on every deterministic bug.
   */
  it("attempts a terminal failure exactly once", async () => {
    expect(await runToCompletion("terminal")).toBe("errored")
    expect((await counts()).term_parse).toBe(1)
  }, 120_000)

  it("retries a transient failure, which is what makes the contrast meaningful", async () => {
    /*
     * The control. Without this, "attempted once" would be indistinguishable from "nothing ever retries",
     * and the assertion above would prove nothing about the classification.
     */
    expect(await runToCompletion("retryable")).toBe("errored")
    expect((await counts()).retry_parse).toBeGreaterThan(1)
  }, 300_000)
})
