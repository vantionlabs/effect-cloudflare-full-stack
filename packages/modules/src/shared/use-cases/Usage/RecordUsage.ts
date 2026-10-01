/**
 * Writes meter rows, **inside a transaction the caller already holds**.
 *
 * Takes the transaction's `sql` and `orgId` rather than opening its own, because the whole point of metering in
 * Postgres is that the meter commits WITH the work it counts: `IngestUpload` writes the document, the intake and
 * the `documents.ingested` row together, so a rolled-back upload is never billed and a committed one always is.
 * A meter written in a separate transaction afterwards could be lost on its own, and that is the drift this
 * design exists to rule out.
 *
 * `on conflict … do nothing` against the partial unique index makes a billable unit count once however often its
 * work is retried. Cost rows have no key and always insert.
 */
import { Db } from "@ea/database/Database"
import type { OrgId } from "@ea/domain/Identity"
import { type ModelUsage, modelUsageEntries, type UsageEntry } from "@ea/modules/shared/domain/Usage"
import { Effect } from "effect"
import type { SqlClient } from "effect/sql"

export const writeUsage = (sql: SqlClient.SqlClient, orgId: OrgId, entries: ReadonlyArray<UsageEntry>) =>
  Effect.forEach(
    entries.filter((entry) => entry.quantity > 0),
    (entry) =>
      sql`
        insert into usage_records (organization_id, meter, quantity, model, subject_id, idempotency_key)
        values (
          ${orgId}, ${entry.meter}, ${Math.round(entry.quantity)}, ${entry.model ?? null},
          ${entry.subjectId ?? null}, ${entry.idempotencyKey ?? null}
        )
        on conflict (organization_id, idempotency_key) where idempotency_key is not null do nothing
      `,
    { discard: true }
  )

/**
 * Records one model call's token cost in its own short transaction.
 *
 * Its own transaction because a model call is not part of a business write — it happens before one, in a
 * Workflow step whose result is memoised. Recorded straight after the call, inside the step: if the step then
 * fails and re-runs, the model is called again and that second call is real spend, recorded again.
 */
export const recordModelUsage = (usage: ModelUsage | undefined) =>
  usage === undefined
    ? Effect.void
    : Effect.flatMap(Db, (db) => db.scopedForOrg((sql, orgId) => writeUsage(sql, orgId, modelUsageEntries(usage))))
