/**
 * What the service can say about itself, as a DOMAIN type.
 *
 * Its own type rather than the wire schema it ends up as, and that separation is what let the use case move out of
 * `apps/worker` at all: `dep:check` forbids `packages/modules` from importing `@ea/api`, because the api package
 * collects the modules' contracts and the reverse is a cycle that fails at runtime rather than at build time
 * (ADR-0012). While `GetHealth` returned `HealthV1` it could only live in the app.
 *
 * It is also the same rule every other slice follows and this one was quietly breaking: a use case produces domain
 * types, and the transport edge maps them to a frozen wire shape. The mapping is three lines in `HealthHttp.ts`,
 * and the version-1 field names (`postgres_version`, snake_case) stay a decision about the public API rather than
 * leaking backwards into the code that gathers the facts.
 */
import { Schema } from "effect"

export class DatabaseHealth extends Schema.Class<DatabaseHealth>("DatabaseHealth")({
  postgresVersion: Schema.String,
  pgvectorVersion: Schema.NullOr(Schema.String),
  /**
   * Whether Dutch Snowball stemming works, proven by asking Postgres whether "verplichting" and "verplichtingen"
   * stem alike rather than by reading a config table. A false here means hybrid retrieval will miss clauses, which
   * rail 1 converts into a flood of `needs_human` — a health signal, not a curiosity.
   */
  dutchStemming: Schema.Boolean
}) {}

export class HealthReport extends Schema.Class<HealthReport>("HealthReport")({
  status: Schema.Literals(["ok", "degraded"]),
  version: Schema.String,
  /** Null when the database could not be reached at all, which is degraded rather than an error. */
  database: Schema.NullOr(DatabaseHealth)
}) {}
