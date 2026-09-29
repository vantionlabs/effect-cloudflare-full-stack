/**
 * A Postgres-backed `WorkflowEngine`: memoisation only, no suspend.
 *
 * **What this buys, precisely.** The decide pipeline is Extract → Retrieve → Decide → Judge. A
 * transient judge failure makes Queues redeliver the message, and without a memo that re-runs the
 * ~EUR 0.05 extraction too. With one, each completed step replays from its stored result. That is the
 * whole requirement — see ADR-0003 for why it is not a Durable Object and not Cloudflare Workflows.
 *
 * **Why not `WorkflowEngine.layerMemory`,** which the framework ships and which is tempting: its memo
 * is a Map in one isolate. A Queues redelivery is a *new invocation*, so everything it remembered is
 * gone — the exact scenario the memo exists for. Its `activityExecute` semantics are ported here,
 * including the non-obvious detail that a stored `Suspended` result counts as a miss.
 *
 * ## What it deliberately does not do
 *
 * `deferredResult` returns `none` and `scheduleClock` dies. So a workflow that awaits a
 * `DurableDeferred` would wait forever — and rather than return `Suspended` and let the caller retry
 * into a hang, **this engine dies with an explanation.** A loud failure at the first attempt beats a
 * Worker that appears to work and never finishes. The human pause is a database row instead
 * (docket spec section 6): a pending decision anyone can query rather than a suspended coroutine
 * somebody has to trust.
 *
 * ## Tenancy
 *
 * Reads and writes go through `Db.scopedForOrg`, so the memo cannot be read across tenants. That matters
 * more than it looks: `workflow_activities.result` contains extracted invoice fields.
 *
 * **`CurrentOrg`, not `CurrentUser`** — the change this file predicted, now made. A workflow engine needs
 * to know which tenant and has no business knowing which person; requiring a user made it unreachable from
 * the queue consumer, which is precisely where a durable workflow belongs (docs/services.md §3.1).
 */
import { CurrentOrg, type OrgId } from "@ea/modules/shared/domain/Identity"
import { Db } from "@ea/modules/shared/tables/Database"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"
import { Workflow, WorkflowEngine } from "effect/workflow"

/**
 * The stored envelope for a completed step or run.
 *
 * Hand-rolled rather than a serialised `Exit`, because the engine works at the encoded level: the
 * values are already JSON, and depending on `Exit`'s wire shape would couple the schema of this table
 * to an internal representation.
 */
type StoredResult =
  | { readonly kind: "success"; readonly value: unknown }
  | { readonly kind: "failure"; readonly error: unknown }

/**
 * What may be memoised, and what must not be.
 *
 * `undefined` means **do not store** — re-run this step next time. That is the case for a defect, and
 * the distinction is load-bearing for two separate reasons:
 *
 * 1. **Correctness of intent.** A typed failure is a decided outcome: an `UnsupportedDocument` does not
 *    become supported on retry, so re-running the model to get the same refusal wastes exactly the
 *    money the memo exists to save. A defect is either a bug (re-running fails again, harmlessly) or a
 *    transient network failure (re-running is the whole point).
 * 2. **It does not round-trip.** `Workflow.intoResult` with captured defects hands back a `Complete`
 *    whose exit failed with a `Die`, so a naive implementation memoises it — and a `Cause` carrying an
 *    `Error` does not survive `JSON.stringify`. Reading it back produced
 *    `TypeError: self.reasons is not iterable`, from inside the error formatter, which is a long way
 *    from the cause. Storing failure VALUES rather than a serialised `Cause` avoids the whole class.
 */
const toStored = (result: Workflow.Result<unknown, unknown>): StoredResult | undefined => {
  if (result._tag !== "Complete") return undefined
  if (Exit.isSuccess(result.exit)) return { kind: "success", value: result.exit.value }
  // A defect, or an interrupt: not a decided outcome. Leave it to re-run.
  if (Cause.hasDies(result.exit.cause) || Cause.hasInterrupts(result.exit.cause)) return undefined
  const failure = Cause.findError(result.exit.cause)
  return failure === undefined ? undefined : { kind: "failure", error: failure }
}

const fromStored = (stored: StoredResult): Workflow.Result<unknown, unknown> =>
  new Workflow.Complete({
    // `Exit.fail` on the stored VALUE, not `failCause` on a deserialised Cause — see toStored, point 2.
    exit: stored.kind === "success" ? Exit.succeed(stored.value) : Exit.fail(stored.error)
  })

/** Refuses a suspension loudly. See the module docstring. */
const refuseSuspend = (what: string): never => {
  throw new Error(
    `${what} suspended, and this engine cannot resume it. \`deferredResult\` returns none and ` +
      `\`scheduleClock\` dies, so an await here would hang forever rather than fail. Either remove the ` +
      `DurableDeferred / DurableClock.sleep, or move to Cloudflare Workflows (ADR-0003).`
  )
}

export const WorkflowEnginePg: Layer.Layer<
  WorkflowEngine.WorkflowEngine,
  never,
  Db | SqlClient.SqlClient | CurrentOrg
> = Layer.effect(WorkflowEngine.WorkflowEngine)(
  Effect.gen(function*() {
    const db = yield* Db

    /*
     * The connection and identity are captured HERE, at layer build.
     *
     * Forced rather than chosen: `WorkflowEngine.Encoded` requires every method to have `R = never`, so
     * they cannot ask for a connection at call time. The consequence is the important part — **this
     * layer must be built inside the request scope, not in the memoised app layer.** A socket cannot
     * outlive the request that opened it on Workers, and an engine memoised per isolate would capture a
     * dead one. `DecideDocument` therefore provides it inside `withDatabase`.
     */
    /*
     * Named `connection`, not `sql`, on purpose.
     *
     * Every callback below receives its own transaction-scoped `sql` from `withOrg`. Shadowing would make
     * the two indistinguishable at a glance, and using this one where a scoped one was meant would run
     * outside the transaction while looking identical — which is the class of bug the compiler cannot see.
     */
    const connection = yield* SqlClient.SqlClient
    const orgId = yield* CurrentOrg

    /** `Db.scopedForOrg` with this message's connection and tenant closed over, so methods are self-contained. */
    const scoped = <A, E>(
      f: (sql: SqlClient.SqlClient, scopedOrgId: OrgId) => Effect.Effect<A, E>
    ) =>
      db.scopedForOrg(f).pipe(
        Effect.provideService(SqlClient.SqlClient, connection),
        Effect.provideService(CurrentOrg, orgId)
      )

    /**
     * Registered workflows, per isolate.
     *
     * Registration is deliberately NOT durable. A workflow this build does not know about cannot be
     * run by this build, and pretending otherwise would let a deploy resurrect a definition that no
     * longer exists.
     */
    const registry = new Map<
      string,
      (payload: object, executionId: string) => Effect.Effect<unknown, unknown, any>
    >()

    const engine: WorkflowEngine.Encoded = {
      register: (workflow, execute) =>
        Effect.sync(() => {
          // `_tag`, NOT `name`. A Workflow's identity is its tag; `workflow.name` resolves to the
          // generic "Workflow" for every definition, which silently keys them all the same — one
          // registry entry, and whichever registered last wins. Caught by a test asserting the stored
          // workflow_name.
          registry.set(workflow._tag, execute)
        }),

      execute: ((workflow: Workflow.Any, options: {
        readonly executionId: string
        readonly payload: object
        readonly discard: boolean
      }) =>
        Effect.gen(function*() {
          const run = registry.get(workflow._tag)
          if (run === undefined) {
            return yield* Effect.die(new Error(`workflow ${workflow._tag} is not registered`))
          }

          // A completed run replays from its stored result without touching the body — which is what
          // makes a redelivered message free rather than merely idempotent.
          const existing = yield* scoped((sql, scopedOrgId) =>
            sql<{ result: StoredResult | null }>`
              select result from workflow_executions
               where execution_id = ${options.executionId} and organization_id = ${scopedOrgId}
            `
          )
          const stored = existing[0]?.result
          if (stored !== null && stored !== undefined) {
            return options.discard ? undefined : fromStored(stored)
          }

          if (existing.length === 0) {
            yield* scoped((sql, scopedOrgId) =>
              sql`
                insert into workflow_executions (execution_id, organization_id, workflow_name, payload)
                values (${options.executionId}, ${scopedOrgId}, ${workflow._tag}, ${
                JSON.stringify(options.payload)
              }::jsonb)
                on conflict (execution_id) do nothing
              `
            )
          }

          const instance = WorkflowEngine.WorkflowInstance.initial(workflow, options.executionId)
          const result = yield* run(options.payload, options.executionId).pipe(
            Workflow.intoResult,
            Effect.provideService(WorkflowEngine.WorkflowInstance, instance),
            Effect.provideService(WorkflowEngine.WorkflowEngine, WorkflowEngine.makeUnsafe(engine))
          )

          if (result._tag !== "Complete") return refuseSuspend(`workflow ${workflow._tag}`)

          // A defective run is deliberately NOT recorded as complete: the row stays open so a
          // redelivery re-enters the body, which is what makes a transient failure recoverable.
          const envelope = toStored(result)
          if (envelope !== undefined) {
            yield* scoped((sql, scopedOrgId) =>
              sql`
                update workflow_executions
                   set result = ${JSON.stringify(envelope)}::jsonb, completed_at = now()
                 where execution_id = ${options.executionId} and organization_id = ${scopedOrgId}
              `
            )
          }

          return options.discard ? undefined : result
        }).pipe(Effect.orDie)) as WorkflowEngine.Encoded["execute"],

      /**
       * The memo. Roughly twenty lines, and the reason the whole engine exists.
       *
       * Keyed on (execution_id, name, attempt) exactly as the reference in-memory engine keys its Map,
       * so the semantics match — including that a stored `Suspended` is treated as a miss.
       */
      activityExecute: (activity, attempt) =>
        Effect.gen(function*() {
          const instance = yield* WorkflowEngine.WorkflowInstance

          const hit = yield* scoped((sql, scopedOrgId) =>
            sql<{ result: StoredResult }>`
              select result from workflow_activities
               where execution_id = ${instance.executionId}
                 and name = ${activity.name}
                 and attempt = ${attempt}
                 and organization_id = ${scopedOrgId}
            `
          )
          if (hit.length > 0) return fromStored(hit[0]!.result)

          // A fresh instance per activity, matching the reference engine: an activity must not inherit
          // the run's suspension flags, or one step's state would leak into the next.
          const activityInstance = WorkflowEngine.WorkflowInstance.initial(
            instance.workflow,
            instance.executionId
          )
          activityInstance.interrupted = instance.interrupted

          const result = yield* activity.executeEncoded.pipe(
            Workflow.intoResult,
            Effect.provideService(WorkflowEngine.WorkflowInstance, activityInstance)
          )

          if (result._tag !== "Complete") return refuseSuspend(`activity ${activity.name}`)

          const envelope = toStored(result)
          if (envelope !== undefined) {
            yield* scoped((sql, scopedOrgId) =>
              sql`
                insert into workflow_activities (execution_id, name, attempt, organization_id, result)
                values (
                  ${instance.executionId}, ${activity.name}, ${attempt}, ${scopedOrgId},
                  ${JSON.stringify(envelope)}::jsonb
                )
                on conflict (execution_id, name, attempt) do nothing
              `
            )
          }

          return result
        }).pipe(Effect.orDie),

      poll: (_workflow, executionId) =>
        scoped((sql, scopedOrgId) =>
          sql<{ result: StoredResult | null }>`
            select result from workflow_executions
             where execution_id = ${executionId} and organization_id = ${scopedOrgId}
          `
        ).pipe(
          Effect.map((rows) => {
            const stored = rows[0]?.result
            return stored === null || stored === undefined
              ? Option.none()
              : Option.some(fromStored(stored))
          }),
          Effect.orDie
        ),

      // No durable runner exists to interrupt or resume, and pretending otherwise would be worse than
      // doing nothing: a caller would believe a running workflow had been stopped.
      interrupt: () => Effect.void,
      interruptUnsafe: () => Effect.void,
      resume: () => Effect.void,

      // Suspend is not supported. `none` forever is the honest answer, and the workflow body is
      // lint-banned from awaiting one — see ADR-0003.
      deferredResult: () => Effect.succeedNone,
      deferredDone: () =>
        Effect.die(
          new Error("DurableDeferred is not supported by WorkflowEnginePg; the human pause is a row")
        ),
      scheduleClock: () =>
        Effect.die(
          new Error("DurableClock is not supported by WorkflowEnginePg; keep sleeps under 60s in an Activity")
        )
    }

    return WorkflowEngine.makeUnsafe(engine)
  })
)
