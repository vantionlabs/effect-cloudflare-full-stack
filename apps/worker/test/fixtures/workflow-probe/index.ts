/**
 * A throwaway Worker that exists to answer ONE question: does a completed `step.do` re-run when a later step
 * fails and the instance retries?
 *
 * That property is the whole reason `WorkflowEnginePg` exists — its `activityExecute` memo is what stops a
 * transient judge failure re-paying for a ~€0.05 extraction. If Cloudflare Workflows gives it natively, 298
 * lines of engine we maintain with no conformance suite can go (risk R7). If it does not, we keep the engine and
 * this fixture is the evidence.
 *
 * **It is a separate Worker with its own config, not a route on ours.** The test harness boots extra Workers
 * from their own wrangler file, so proving a platform property costs no production surface — no binding on our
 * `Env`, no class exported from `Main.ts`, nothing for `bindings:check` to reconcile. Delete the directory and
 * the probe is gone.
 *
 * Counts live in KV rather than Postgres deliberately: the question is about the platform, and dragging the
 * `cloudflare:sockets` driver into it would mean a failure here had two possible causes.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from "cloudflare:workers"

/*
 * Hand-written because this fixture is never deployed and so has no generated types — normally `wrangler types`
 * produces `Env` and a hand-written one is an anti-pattern, since it drifts from the config. The BINDING types
 * are the platform's own (`Workflow`, `KVNamespace`), which is the half that matters.
 */
interface Env {
  readonly PROBE: Workflow
  readonly COUNTS: KVNamespace
}

/** Counts a call and returns the new total. KV has no atomic increment; a probe does not need one. */
const bump = async (kv: KVNamespace, step: string): Promise<number> => {
  const current = Number((await kv.get(`count:${step}`)) ?? "0") + 1
  await kv.put(`count:${step}`, String(current))
  return current
}

export class StepMemoWorkflow extends WorkflowEntrypoint<Env> {
  /*
   * `override`, because `WorkflowEntrypoint` declares `run`. And the event arrives as `Readonly<...>` — the
   * type enforcing Rule 5, "do not mutate incoming events", which is otherwise a convention you have to
   * remember.
   */
  override async run(_event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep): Promise<void> {
    /*
     * Retries are set EXPLICITLY because the default is not documented in the Rules of Workflows, and a probe
     * that depended on an undocumented default would be measuring the wrong thing. One second, constant, so the
     * test is quick; 30 seconds is well inside the 30-minute step ceiling.
     */
    const retries: WorkflowStepConfig = {
      retries: { limit: 3, delay: "1 second", backoff: "constant" },
      timeout: "30 seconds"
    }

    await step.do("one", retries, async () => {
      await bump(this.env.COUNTS, "one")
      return "one-done"
    })

    /*
     * Fails on its first attempt and succeeds on its second. The COUNT is what decides, not a flag, so the
     * decision survives the step function being re-entered from scratch — which is exactly what is under test.
     */
    await step.do("two", retries, async () => {
      const attempt = await bump(this.env.COUNTS, "two")
      if (attempt === 1) throw new Error("forced failure, to make the instance retry")
      return "two-done"
    })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === "/start") {
      const instance = await env.PROBE.create()
      return Response.json({ id: instance.id })
    }

    if (url.pathname === "/status") {
      const instance = await env.PROBE.get(url.searchParams.get("id")!)
      return Response.json(await instance.status())
    }

    if (url.pathname === "/counts") {
      return Response.json({
        one: Number((await env.COUNTS.get("count:one")) ?? "0"),
        two: Number((await env.COUNTS.get("count:two")) ?? "0")
      })
    }

    return new Response("not found", { status: 404 })
  }
}
