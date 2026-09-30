/**
 * Does a completed Cloudflare Workflow step re-run when a later step fails?
 *
 * The answer decides whether `WorkflowEnginePg` — 298 lines we maintain with no conformance suite (risk R7) —
 * can be deleted. Its `activityExecute` memo exists for exactly one property: a transient failure late in the
 * decide pipeline must not re-pay for the extraction earlier in it.
 *
 * The Rules of Workflows claim this property in prose — *"step names act as the 'cache key' in your Workflow"*,
 * *"successfully cached steps do not re-execute"*. This asserts it by execution, which is how ADR-0009 settled
 * the `cloudflare:sockets` question rather than trusting a docs sentence.
 *
 * Gated with the rest of the `worker` project: it boots a real `workerd`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestHarness } from "wrangler"

let server: ReturnType<typeof createTestHarness>

beforeAll(async () => {
  server = createTestHarness({
    // Its OWN Worker, so proving a platform property costs no production surface — no binding on our `Env`, no
    // class exported from `Main.ts`, nothing for `bindings:check` to reconcile.
    workers: [{ configPath: new URL("./fixtures/workflow-probe/wrangler.jsonc", import.meta.url).pathname }]
  })
  await server.listen()
})

afterAll(async () => {
  await server?.close()
})

const counts = async (): Promise<{ readonly one: number; readonly two: number }> =>
  await (await server.fetch("/counts")).json() as { readonly one: number; readonly two: number }

describe("a completed step.do", () => {
  it("does NOT re-run when a later step fails and the instance retries", async () => {
    const started = await server.fetch("/start", { method: "POST" })
    expect(started.status).toBe(200)
    const { id } = await started.json() as { readonly id: string }

    // Poll rather than sleep: the instance runs asynchronously, and a fixed wait would either flake or be slow.
    let status = ""
    for (let attempt = 0; attempt < 60; attempt = attempt + 1) {
      const body = await (await server.fetch(`/status?id=${id}`)).json() as { readonly status: string }
      status = body.status
      if (status === "complete" || status === "errored" || status === "terminated") break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    expect(status).toBe("complete")

    const observed = await counts()
    /*
     * The assertion the engine exists for. Step `two` ran twice — it failed on its first attempt on purpose —
     * and step `one`, which had already completed, ran exactly ONCE.
     */
    expect(observed.two).toBe(2)
    expect(observed.one).toBe(1)
  })
})
