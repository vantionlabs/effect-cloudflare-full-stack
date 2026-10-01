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
import { MentionTable } from "@ea/modules/chat/tables/Mention"
import { MessageLifecycle, MessageRooms, MessageTable } from "@ea/modules/chat/tables/Message"
import { ReactionTable } from "@ea/modules/chat/tables/Reaction"
import { RoomReadTable } from "@ea/modules/chat/tables/Read"
import { RoomTable } from "@ea/modules/chat/tables/Room"
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
import { ReportDeliveryTable } from "@ea/modules/reporting/tables/ReportDelivery"
import { ChangeProposalTable, SalesTable } from "@ea/modules/sales/tables/Sales"
import { Migrator } from "effect/sql"
import { CorpusKnowledge } from "../Corpus/CorpusTable.ts"
import { EventIndexType, EventTable } from "../Event/EventTable.ts"
import { TenancyTable } from "../Tenancy/TenancyTable.ts"
import { UsageTable } from "../Usage/UsageTable.ts"

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
  "0016_messages": MessageTable,
  // Named channels, which is the trigger `Message.ts` said would justify a rooms table.
  "0017_rooms": RoomTable,
  /*
   * Moves `messages` from (subject_kind, subject_id) onto `room_id`.
   *
   * A TRANSITION rather than a re-application: it backfills from columns it then drops, so unlike
   * `0015_rule_conditions` it cannot be expressed by re-running the table's own definition. It must also run
   * after `rooms` exists, which is the other reason it is its own key.
   */
  "0018_messages_rooms": MessageRooms,
  /*
   * `messages` gains `edited_at` and `deleted_at`.
   *
   * Its OWN file rather than re-applying `MessageTable` — which is the `0015_rule_conditions` pattern and would
   * be wrong here, because `0018` dropped the columns `MessageTable`'s index names. Writing it the other way is
   * what produced `column "subject_kind" does not exist`.
   */
  "0019_message_lifecycle": MessageLifecycle,
  // Reactions. Keyed by (message, user, emoji), so reacting twice is a conflict rather than a duplicate.
  "0020_reactions": ReactionTable,
  // Read positions, from which unread counts are COUNTED rather than stored.
  "0021_room_reads": RoomReadTable,
  // Mentions, resolved once at write time rather than parsed on every read.
  "0022_mentions": MentionTable,
  /*
   * better-auth's `apikey` table, from the `@better-auth/api-key` plugin.
   *
   * Re-applies the GENERATED auth schema rather than writing the DDL again, which is the `0015_rule_conditions`
   * pattern and is safe here for a reason worth checking before copying it: every statement in that file is
   * `create table if not exists` or `create index if not exists`, so a second run is a no-op. Re-applying a file
   * that has since been altered by a later migration is what produced `column "subject_kind" does not exist` —
   * see `0019_message_lifecycle`.
   *
   * Pointing at the generated file keeps the schema single-sourced, so `bun run auth:check` covers this table too.
   */
  "0023_auth_api_key": SessionTable,
  /*
   * `events` gains `workflow_instance_id`, because the queue now hands the decide pipeline to a Cloudflare
   * Workflow instead of running it inline (ADR-0024).
   *
   * Re-applies `EventTable` — the `0015_rule_conditions` pattern — which is safe because the added statement
   * is `add column if not exists` and every other statement in that file is `if not exists` too. Checked
   * rather than assumed: re-applying a file that a LATER migration has since altered is what produced
   * `column "subject_kind" does not exist`, and nothing has altered `events`.
   */
  "0024_event_workflow_instance": EventTable,
  // Usage metering: one row per metered consumption, written in the transaction of the work it counts.
  "0025_usage": UsageTable,
  // `document.index`: uploads to a corpus collection are chunked and embedded, which nothing did before.
  "0026_event_index_type": EventIndexType,
  // `knowledge`: technical documentation, a corpus of its own that invoice decisions never search.
  "0027_corpus_knowledge": CorpusKnowledge,
  // The weekly report's once-per-week claim.
  "0028_report_deliveries": ReportDeliveryTable,
  // Sales: the price list, quotes and their lines.
  "0029_sales": SalesTable,
  // Price-list changes proposed by asking, applied only by a person.
  "0030_change_proposals": ChangeProposalTable
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
