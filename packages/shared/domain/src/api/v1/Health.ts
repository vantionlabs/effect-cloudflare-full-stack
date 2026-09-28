/**
 * The health endpoint's wire contract.
 *
 * This lives in the `v1` namespace and is a frozen, snake_case wire type — not a domain
 * type re-exported for convenience. The boundary exists so a domain rename can never
 * silently break a client we do not control (the Laravel consumer being the concrete
 * case). See ADR-0006 and the API-first section of docs/PLAN.md.
 */
import { Schema } from "effect"

/** What the database reports about itself. Present only when the check succeeded. */
export class DatabaseHealthV1 extends Schema.Class<DatabaseHealthV1>("DatabaseHealthV1")({
  postgres_version: Schema.String,
  pgvector_version: Schema.NullOr(Schema.String),
  /**
   * Whether Dutch Snowball stemming is available, proven by asking Postgres whether
   * "verplichting" and "verplichtingen" stem alike rather than by reading a config table.
   * A false here means hybrid retrieval will miss clauses, which rail 1 converts into a
   * flood of `needs_human` — so it is a health signal, not a curiosity.
   */
  dutch_stemming: Schema.Boolean
}) {}

export class HealthV1 extends Schema.Class<HealthV1>("HealthV1")({
  status: Schema.Literals(["ok", "degraded"]),
  /** The deployed version, so a response can be tied to a commit. */
  version: Schema.String,
  database: Schema.NullOr(DatabaseHealthV1)
}) {}
