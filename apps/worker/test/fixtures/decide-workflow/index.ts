/**
 * The REAL `DecideWorkflow` orchestration, in real `workerd`, with counting fake work.
 *
 * What this asserts is the thing the migration turns on and the step-memo probe could not: that **our**
 * composition memoises the three expensive steps, and that the rails-and-write half deliberately does not.
 * The probe proved the platform remembers a step; this proves we arranged ours so that the right ones are
 * remembered.
 *
 * The work is fake on purpose. The pipeline's logic has 11 tests against real Postgres in Node — running a
 * model here would test the provider, cost neurons, and make a memo assertion flaky. What is platform-shaped
 * is the orchestration, and that is all this exercises: the class is imported from `src/`, so the step names,
 * the order, the retry policy and the short circuit are the deployed ones.
 *
 * Counts live in KV rather than module state because a retry may land in a different isolate, and a counter
 * that silently reset would make a memo look like it worked. Same reasoning as the workflow probe beside it.
 */
import { makeDecideWorkflow } from "../../../src/DecideWorkflow.ts"

interface ProbeEnv {
  readonly DECIDE: Workflow
  /** The same orchestration whose short circuit fires, so the early return is observable. */
  readonly SHORT: Workflow
  readonly COUNTS: KVNamespace
}

/** Increments a counter and returns its new value, so a caller can act on which attempt this is. */
const bump = async (kv: KVNamespace, key: string): Promise<number> => {
  const current = Number((await kv.get(key)) ?? "0") + 1
  await kv.put(key, String(current))
  return current
}

/*
 * The fake work, bound the way `Main.ts` binds the real thing.
 *
 * `settle` FAILS on its first attempt, which is the whole point: it is the step that is deliberately not a
 * `step.do`, so the instance retries, `run()` re-executes from the top, and the three cached steps must not
 * run again. `existing` returns undefined so the short circuit does not fire — there is a separate route
 * for testing that it does.
 */
const work = (env: ProbeEnv) => ({
  existing: async () => {
    await bump(env.COUNTS, "existing")
    return undefined
  },
  extract: async () => {
    await bump(env.COUNTS, "extract")
    return {
      fields: { supplier: { value: "ACME" } },
      checksPassed: true,
      unverified: [],
      arithmeticFailures: [],
      retrievalQuery: "acme goedkeuring"
    }
  },
  retrieve: async () => {
    await bump(env.COUNTS, "retrieve")
    return { mode: "hybrid", chunks: [{ chunk_id: "c1", content: "een clausule" }] }
  },
  decide: async () => {
    await bump(env.COUNTS, "decide")
    return { outcome: "route_for_approval", citations: [], rationale: "omdat" }
  },
  settle: async () => {
    const attempt = await bump(env.COUNTS, "settle")
    if (attempt === 1) {
      throw new Error("forced failure, to make the instance retry after the steps have been cached")
    }
    return {
      decisionId: "dec_1",
      outcome: "route_for_approval" as const,
      railsFired: [],
      retrievalMode: "hybrid",
      replayed: false
    }
  }
})

/**
 * A second binding of the same class whose short circuit FIRES, so the early return is observable.
 *
 * `existing` returning a decision must mean no step runs at all — that is the guarantee that makes a
 * redelivered message free, and it is strictly stronger than the memo.
 */
const shortCircuitWork = (env: ProbeEnv) => ({
  ...work(env),
  existing: async () => {
    await bump(env.COUNTS, "sc_existing")
    return {
      decisionId: "dec_existing",
      outcome: "auto_approve" as const,
      railsFired: [],
      retrievalMode: "hybrid",
      replayed: true
    }
  },
  extract: async () => {
    await bump(env.COUNTS, "sc_extract")
    throw new Error("the short circuit should have returned before any step ran")
  }
})

// Two classes over one orchestration, because a Workflow's behaviour is only observable through an instance.
export const DecideWorkflow = makeDecideWorkflow(work as never)
export const ShortCircuitWorkflow = makeDecideWorkflow(shortCircuitWork as never)

const PARAMS = {
  orgId: "org_probe",
  documentId: "doc_probe",
  documentText: "FACTUUR\nACME\nTotaal: EUR 100,00",
  vertical: "invoice"
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === "/start") {
      const binding = url.searchParams.get("short") === "1" ? env.SHORT : env.DECIDE
      const instance = await binding.create({ params: PARAMS })
      return Response.json({ id: instance.id })
    }
    if (url.pathname === "/status") {
      const id = url.searchParams.get("id")!
      const binding = url.searchParams.get("short") === "1" ? env.SHORT : env.DECIDE
      const instance = await binding.get(id)
      return Response.json(await instance.status())
    }
    if (url.pathname === "/counts") {
      const keys = ["existing", "extract", "retrieve", "decide", "settle", "sc_existing", "sc_extract"]
      const entries = await Promise.all(
        keys.map(async (key) => [key, Number((await env.COUNTS.get(key)) ?? "0")] as const)
      )
      return Response.json(Object.fromEntries(entries))
    }
    return new Response("not found", { status: 404 })
  }
} satisfies ExportedHandler<ProbeEnv>
