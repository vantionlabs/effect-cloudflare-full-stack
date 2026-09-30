/**
 * The migration set, and the one place that decides ordering.
 *
 * Cross-slice by nature, which is why it sits in `shared/tables` and imports each slice's own
 * `*.table.ts`: the tables belong to their slices, but the *order* they run in is global and there
 * can only be one answer to it. Listing them explicitly rather than globbing is deliberate — a glob
 * makes ordering depend on filesystem iteration, and a migration that runs out of order against a
 * real database is not recoverable by re-running it.
 *
 * The keys are `<id>_<name>` and are **permanent**: they are what `effect_sql_migrations` records,
 * so renaming one re-runs it. That is why `0002_intake` still names the documents table.
 *
 * `0003_auth` is generated from the installed better-auth by `bun scripts/auth-schema.ts`, not by
 * @better-auth/cli (which lags the library by three minors). The Migrator stays authoritative for
 * **every** table including better-auth's — one migration system, one database — so
 * `better-auth migrate` is never run (plan risk R9).
 */
import { DecisionTable } from "@ea/modules/decision/tables/Decision"
import { ExecutionTable } from "@ea/modules/decision/tables/Execution"
import { ExtractionTable } from "@ea/modules/decision/tables/Extraction"
import { RuleTable } from "@ea/modules/decision/tables/Rule"
import { WorkflowTable } from "@ea/modules/decision/tables/Workflow"
import { SessionTable } from "@ea/modules/iam/tables/Session"
import { DocumentTable } from "@ea/modules/intake/tables/Document"
import { IntakeTable } from "@ea/modules/intake/tables/Intake"
import { ChunkTable } from "@ea/modules/policy/tables/Chunk"
import { RetrievalTable } from "@ea/modules/policy/tables/Retrieval"
import { MessageTable } from "@ea/modules/realtime/tables/Message"
import { Migrator } from "effect/sql"
import { EventTable } from "../Event/EventTable.ts"
import { TenancyTable } from "../Tenancy/TenancyTable.ts"

export const migrations = {
  "0001_tenancy": TenancyTable,
  "0002_intake": DocumentTable,
  // Generated from the installed better-auth by `bun scripts/auth-schema.ts`.
  "0003_auth": SessionTable,
  "0004_intake": IntakeTable,
  "0005_extraction": ExtractionTable,
  "0006_policy": ChunkTable,
  /*
   * The retrieval function is its own migration, and is re-applied under a NEW key whenever its
   * definition changes.
   *
   * `create or replace function` makes that safe, and it keeps one authoritative definition in one
   * file — the alternative, editing an applied migration in place, would silently leave every
   * existing database on the old version. So the same effect appears twice here on purpose: the
   * second key is "apply the current definition again".
   *
   * 0008 fixed the lexical half from AND to OR semantics. Measured: recall@8 31% -> 92%.
   */
  "0007_retrieval": RetrievalTable,
  "0008_retrieval_or": RetrievalTable,
  "0009_workflow": WorkflowTable,
  "0010_rule": RuleTable,
  "0011_decision": DecisionTable,
  "0012_event": EventTable,
  "0013_execution": ExecutionTable,
  // Re-applied: retrieve_policy takes the organization as a parameter now, not current_org().
  "0014_retrieval_org_param": RetrievalTable,
  /*
   * Re-applied: `rules` gains require_po, approved_suppliers and min_payment_days.
   *
   * Same pattern as the retrieval function above — one authoritative definition in one file, applied
   * again under a new key, rather than editing 0010 in place and leaving every existing database on the
   * old shape. The added statements are `add column if not exists`, so re-running is a no-op.
   */
  "0015_rule_conditions": RuleTable,
  // Chat: `messages`, the record a room deliberately is not (ADR-0018).
  "0016_messages": MessageTable
}

export const loader = Migrator.fromRecord(migrations)

/**
 * Applies any outstanding migrations. Safe to run repeatedly; each is recorded once in
 * `effect_sql_migrations`.
 *
 * `Migrator.make` is curried: the first call configures schema dumping (skipped — a Worker has no
 * filesystem to dump to), the second takes the loader.
 */
export const migrate = Migrator.make({})({ loader })
