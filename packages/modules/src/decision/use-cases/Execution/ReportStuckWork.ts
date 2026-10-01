/**
 * Reports work that is stuck, and **resolves nothing.**
 *
 * ADR-0013 names this and `ExecutionTable.ts` promised it: _"a cron REPORTS stuck claims to an operator
 * view and must not resolve them."_ The restraint is the design. An ambiguous `pending` execution may mean
 * the adapter call succeeded and only the recording write was lost — no transaction can tell you which,
 * because the outbound call happens outside any database. So a sweeper that "recovered" one would pay a
 * supplier twice, which is the single most expensive thing this system can do.
 *
 * ## Two kinds of stuck, and the second one is new
 *
 * **An ambiguous execution claim.** `status = 'pending'` past a grace period. Reported, never retried; the
 * decision is marked `needs_attention` by the path that noticed, not by this.
 *
 * **An event whose Workflow instance never came back.** The queue flip (ADR-0024) made `processing` mean
 * "an instance is working on this", and the instance writes the row's finish. If it dies in a way its own
 * catch cannot record — evicted, terminated, or killed mid-write — the row stays `processing` with a
 * `workflow_instance_id` on it and nothing else will ever touch it. **That state did not exist before
 * 2026-09-30 and this is the thing that notices it.** The id is in the report precisely so an operator can
 * run `wrangler workflows instances describe` against it.
 *
 * An event stuck in `processing` with NO instance id is reported too: that is the `decision.execute` path,
 * which still runs inline, dying between the status write and the ack.
 *
 * ## Why it only logs
 *
 * There is no operator UI yet, so the report is structured log lines with the ids attached — which is what
 * `events` exists for in the first place ("Queues has no queryable history", now also applied to
 * Workflows). When a console view lands it reads the same rows; nothing here needs to change.
 */
import { Db } from "@ea/database/Database"
import { Effect } from "effect"

/**
 * How long before work counts as stuck.
 *
 * Longer than `SweepEnqueueGap`'s two minutes, and deliberately: that sweeper looks for rows that were
 * never STARTED, which is instant to diagnose, while this one looks at work in flight. A decide pipeline
 * with an OCR call in it can legitimately take minutes, and a report that cried about healthy work would
 * stop being read — which is the failure mode this whole file is written against.
 */
const STUCK_AFTER = "15 minutes"

/** A bound, so one bad hour cannot produce a log nobody can scroll. `more` says when it was hit. */
const MAX_PER_TICK = 50

/**
 * What was found, as IDS and not only counts.
 *
 * The cron logs the counts, so counts would have been enough for the feature — and they are not enough for
 * anything else. Returning identifiers makes this testable without depending on how many rows other work
 * left lying around (the read is cross-tenant by design, so a count is a property of the whole database),
 * and it is what a console view would render when one exists.
 */
export interface StuckWork {
  readonly executions: ReadonlyArray<{ readonly id: string; readonly organizationId: string }>
  readonly events: ReadonlyArray<{
    readonly id: string
    readonly organizationId: string
    readonly workflowInstanceId: string | null
  }>
  readonly pendingExecutions: number
  readonly stuckEvents: number
  /** True when either query hit the limit, so an operator can tell a backlog from a quiet tick. */
  readonly more: boolean
}

export const ReportStuckWork = Effect.gen(function*() {
  const db = yield* Db

  /*
   * Cross-tenant by necessity, and IDENTIFIERS ONLY.
   *
   * A cron has no organization, and "which tenants have stuck work" is the question rather than an input.
   * The rule `unscopedForCron` carries is that an unscoped read selects ids and never payloads — so a bug
   * in this statement cannot become a tenant data leak. `organization_id` is selected because an operator
   * needs to know whose work is stuck; it is an identifier, not content.
   */
  const executions = yield* db.unscopedForCron((sql) =>
    sql<{ id: string; organization_id: string; decision_id: string }>`
      -- tenant: the organization is the answer
      select id, organization_id, decision_id
        from executions
       where status = 'pending'
         and claimed_at < now() - interval '${sql.literal(STUCK_AFTER)}'
       order by claimed_at
       limit ${MAX_PER_TICK}
    `
  )

  const events = yield* db.unscopedForCron((sql) =>
    sql<{ id: string; organization_id: string; type: string; workflow_instance_id: string | null }>`
      -- tenant: the organization is the answer
      select id, organization_id, type, workflow_instance_id
        from events
       where status = 'processing'
         and started_at < now() - interval '${sql.literal(STUCK_AFTER)}'
       order by started_at
       limit ${MAX_PER_TICK}
    `
  )

  /*
   * One line per item, at WARNING.
   *
   * Not one aggregate line: an operator's next action is to look at a specific execution or a specific
   * Workflow instance, and a count tells them only that they should start looking. The ids are the report.
   */
  for (const row of executions) {
    yield* Effect.logWarning("stuck.execution").pipe(
      Effect.annotateLogs({
        executionId: row.id,
        decisionId: row.decision_id,
        organizationId: row.organization_id,
        stuckAfter: STUCK_AFTER,
        // Said out loud in the log, because the temptation to "just retry it" is the whole risk (ADR-0013).
        action: "a human decides; this must not be retried automatically"
      })
    )
  }

  for (const row of events) {
    yield* Effect.logWarning("stuck.event").pipe(
      Effect.annotateLogs({
        eventId: row.id,
        type: row.type,
        organizationId: row.organization_id,
        workflowInstanceId: row.workflow_instance_id,
        stuckAfter: STUCK_AFTER,
        action: row.workflow_instance_id === null
          ? "no instance was recorded: the consumer died between marking processing and acking"
          : "ask the Workflow: wrangler workflows instances describe <workflowInstanceId>"
      })
    )
  }

  return {
    executions: executions.map((row) => ({ id: row.id, organizationId: row.organization_id })),
    events: events.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      workflowInstanceId: row.workflow_instance_id
    })),
    pendingExecutions: executions.length,
    stuckEvents: events.length,
    more: executions.length === MAX_PER_TICK || events.length === MAX_PER_TICK
  } satisfies StuckWork
})
