/**
 * The decide pipeline as a Cloudflare Workflow — the orchestration production runs (ADR-0024).
 *
 * Three `step.do` calls and nothing else. The logic is `decision/use-cases/Decision/DecideSteps.ts`, shared
 * verbatim with the `effect/workflow` composition that tests and the eval harness run in Node, so the two
 * differ in exactly one dimension: **who remembers a completed step.** Here it is the platform, keyed on the
 * step name, which `apps/worker/test/WorkflowStepMemo.test.ts` proved by execution before anything was
 * migrated to it.
 *
 * ## Why this is a factory rather than a class
 *
 * A `WorkflowEntrypoint` is instantiated by the runtime, so nothing can be handed to it — and it needs the
 * composed Effect runtime, which lives in `Main.ts`. Importing `Main.ts` from here would be a cycle, because
 * `Main.ts` must export this class for the runtime to find it. That cycle would probably work (the import is
 * only used inside `run`, long after module init) and it is not worth finding out: an import cycle between
 * two schema files in this repo failed as
 * `Cannot read properties of undefined (reading 'ast')`, pointing at the wrong file entirely.
 *
 * So the composition root passes the work IN, already bound to its runtime and its tenant, and this file
 * holds only what belongs to the platform: step names, retry policy, and order. It also keeps every service
 * type out of here, which is what lets this file avoid naming a single port.
 *
 * ## Where the database connection is opened, which corrects ADR-0024
 *
 * That ADR says *"the connection opens in `run()`, and steps use it"*, following the Rules of Workflows.
 * **That shape does not fit an Effect-based body**, and saying so is more useful than quietly doing
 * something else: a `step.do` callback is an `async` function, so a single Effect scope cannot span the
 * steps without inverting control — awaiting each step's promise from inside the scope and providing the
 * captured `SqlClient` to each one. That is possible and it buys one connection per instance instead of one
 * per step that needs the database, which is two of the four.
 *
 * It is not worth the inversion. Hyperdrive opens in single-digit milliseconds (p90 4 ms), the steps run
 * sequentially so the six-connection cap is never approached, and the Rule's actual concern — a
 * non-serializable resource crossing a step boundary — is satisfied either way, because no connection is
 * ever returned from a step. So each bound work function opens its own connection, exactly as every HTTP
 * request already does.
 */
import type { DecideResult } from "@ea/modules/decision/use-cases/Decision"
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from "cloudflare:workers"
import type { Env } from "./platform/Bindings.ts"

/**
 * What the workflow is asked to do — three ids and a tenant, never a document.
 *
 * `orgId` is in the params because a Workflow instance has no session and no event row to read: the queue
 * resolves the tenant and passes it. Every bound work function takes it, so there is no path that runs a
 * step without one.
 *
 * **`documentText` used to be here and is not any more**, which is what unblocked the queue flip. Workflow
 * params are serialized and persisted, and a step's non-stream return is capped at 1 MiB — a scanned
 * document's text can approach that, so a large invoice would have failed at instance creation. Parsing is
 * the first step now, which also memoises it: with OCR configured, re-parsing on a retry is a paid API call
 * rather than 16 ms of wasm.
 */
export interface DecideParams {
  readonly orgId: string
  readonly documentId: string
  readonly vertical: string
}

/**
 * The pipeline's work, bound to a runtime and a tenant by the composition root.
 *
 * Deliberately five plain async functions rather than a runtime handle: it keeps every service type out of
 * this file, so the platform glue names no port, and it is fully typed by inference at the call site with no
 * generic plumbing.
 */
export interface DecideWork {
  readonly existing: (params: DecideParams) => Promise<DecideResult | undefined>
  /** Reads the blob and parses it. The same derivation the queue path used to run inline. */
  readonly parse: (params: DecideParams) => Promise<string>
  readonly extract: (params: DecideParams, documentText: string) => Promise<ExtractedFields>
  readonly retrieve: (params: DecideParams, query: string) => Promise<RetrievedPolicy>
  readonly decide: (params: DecideParams, fields: unknown, policy: RetrievedPolicy) => Promise<ProposedValue>
  readonly settle: (
    params: DecideParams,
    extraction: ExtractedFields,
    retrieval: RetrievedPolicy,
    proposal: ProposedValue,
    startedAt: number
  ) => Promise<DecideResult>
}

/**
 * An opaque JSON object crossing a step boundary.
 *
 * `object` rather than a recursive `Json` union, and the reason is worth recording because I tried the
 * recursive one first: **`step.do`'s return type is a MAPPED type** (`Serializable<T>` descends into every
 * property), so a recursive JSON alias makes it diverge — `TS2589: Type instantiation is excessively deep`.
 * The platform can only check a boundary it can finish traversing.
 *
 * `unknown` does not work either, and the platform is right to refuse it: `unknown` admits `undefined`, a
 * `Map`, a class instance with methods. `object` says exactly what is true here — a JSON object whose shape
 * the module's schemas define and this file does not need to know.
 */
type JsonObject = object

/**
 * What each step returns, as it exists AFTER serialisation.
 *
 * Deliberately not the module's own types. Those describe what the step produces; these describe what the
 * next step receives, and the difference is not cosmetic — `Retrieval` and `ProposedDecision` are
 * `Schema.Class`es, so a step whose result was replayed from the platform's cache hands back a plain object
 * and not a class instance. Nothing downstream of a step may call a method on one, and typing the boundary
 * this way is what makes that a compile error rather than a `TypeError` on a replay.
 *
 * The composition root casts the module's values into these once, where the compiler already checks the
 * join — see `decideWork` in `Main.ts`.
 */
export interface ExtractedFields {
  readonly fields: JsonObject
  readonly checksPassed: boolean
  readonly unverified: ReadonlyArray<string>
  readonly arithmeticFailures: ReadonlyArray<string>
  readonly retrievalQuery: string
}

/** The retrieved clauses, as JSON. `mode` is what rail 4 reads, so it is named rather than left loose. */
export interface RetrievedPolicy {
  readonly mode: string
  readonly chunks: ReadonlyArray<JsonObject>
}

/** The model's proposal, as JSON. Its shape is `ProposedDecision`'s; the rails are what interpret it. */
export type ProposedValue = JsonObject

/**
 * Retries are set EXPLICITLY on every step, because the default is undocumented.
 *
 * Five attempts with exponential backoff matches the queue's `max_retries: 5`, so moving a pipeline between
 * the two does not silently change how many times a flaky provider is tolerated. The 30-second cap is a
 * platform maximum on a step's own timeout being 30 MINUTES — this is well inside it, and a model call that
 * has not answered in five minutes is not going to.
 */
const RETRIES: WorkflowStepConfig = {
  retries: { limit: 5, delay: "2 seconds", backoff: "exponential" },
  timeout: "5 minutes"
}

/**
 * The class the factory returns, named as an interface rather than inferred.
 *
 * Required, not stylistic: `WorkflowEntrypoint`'s `ctx` and `env` are PROTECTED, and TypeScript refuses to
 * emit a declaration for an exported anonymous class that has them —
 * `TS4094: Property 'env' of exported anonymous class type may not be private or protected`. Annotating the
 * return type means the exported type is this interface, and the anonymous class stays an implementation
 * detail. The runtime still receives a real class with a real prototype chain, which is all it needs.
 */
export interface DecideWorkflowClass {
  new(ctx: ExecutionContext, env: Env): {
    run(event: Readonly<WorkflowEvent<DecideParams>>, step: WorkflowStep): Promise<DecideResult>
  }
}

export const makeDecideWorkflow = (work: (env: Env, orgId: string) => DecideWork): DecideWorkflowClass =>
  class DecideWorkflow extends WorkflowEntrypoint<Env, DecideParams> {
    override async run(
      event: Readonly<WorkflowEvent<DecideParams>>,
      step: WorkflowStep
    ): Promise<DecideResult> {
      const params = event.payload
      const bound = work(this.env, params.orgId)
      const startedAt = Date.now()

      /*
       * The short circuit, OUTSIDE any step.
       *
       * Deliberately not memoised: it is a read, it is cheap, and it must see the current state of the
       * `decisions` table rather than a remembered answer from a previous attempt. It is also strictly
       * earlier than any memo — a memo saves re-running a step, this saves entering the pipeline.
       */
      const existing = await bound.existing(params)
      if (existing !== undefined) return existing

      // Step names are the cache key, so they are fixed, deterministic, and match the activity names the
      // Postgres engine used — which keeps the two orchestrators comparable when reading logs.
      /*
       * Each result is cast back from the platform's `Serializable<T>` wrapper.
       *
       * The cast is the honest marker of a real boundary rather than a workaround: what comes back is what
       * survived JSON, and the schemas in `DecideSteps.ts` are what guarantee the two are the same shape.
       * `Retrieval` and `ProposedDecision` are `Schema.Class`es, so a replayed step returns a plain object
       * rather than a class instance — which is why nothing downstream of a step may call a method on one.
       */
      /*
       * (1) Parse, and it is a step for a reason that only became true with tier 3.
       *
       * Reading and converting a document was 16 ms of wasm; with OCR configured it is a paid API call at
       * about $4 per 1,000 pages. A retry that re-parsed would re-pay for it, which is precisely what a
       * memoised step exists to prevent — and it is why the text is derived HERE rather than carried in the
       * params, where a large document would have hit the 1 MiB cap.
       */
      const documentText = await step.do("Parse", RETRIES, () => bound.parse(params)) as string

      const extraction = await step.do(
        "Extract",
        RETRIES,
        () => bound.extract(params, documentText)
      ) as ExtractedFields
      const retrieval = await step.do(
        "Retrieve",
        RETRIES,
        () => bound.retrieve(params, extraction.retrievalQuery)
      ) as RetrievedPolicy
      const proposal = await step.do(
        "Decide",
        RETRIES,
        () => bound.decide(params, extraction.fields, retrieval)
      ) as ProposedValue

      /*
       * The rails, the write, the emit and the metric — a STEP, and it took a failed test to get this right.
       *
       * It was outside any step at first, on the reasoning that a memoised rail could be replayed past a
       * rail that has since been tightened, and that `run()` re-executing from the top would re-apply it.
       * **`run()` does not re-execute.** An error thrown outside a `step.do` fails the whole instance with
       * no retry — measured, not read: the instance ended `errored` with every counter at 1. Only a step's
       * own failure is retried, under that step's policy.
       *
       * So anything outside a step has NO retry, which for the write would be strictly worse than the queue
       * it is replacing. The memo concern turns out to be theoretical by comparison: a cached settle result
       * is replayed only within one instance, which is one decision, and the short circuit already returns
       * older decisions without re-railing them.
       *
       * What this required instead is that the step be idempotent, because a retry can re-enter it with the
       * decision already written — so the insert became a claim (`on conflict … do nothing returning id`).
       * See `settleDecision`.
       */
      return await step.do(
        "Settle",
        RETRIES,
        () => bound.settle(params, extraction, retrieval, proposal, startedAt)
      ) as DecideResult
    }
  }
