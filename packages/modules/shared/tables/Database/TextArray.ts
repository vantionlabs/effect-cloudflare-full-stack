/**
 * Writing a `text[]` column, including an empty one.
 *
 * Exists because of a specific driver behaviour worth knowing: passing a JavaScript array as a query
 * parameter fails with **"Cannot infer the type of an empty array"** when the array is empty. The
 * driver reads the element type from the first element, and there isn't one. So the columns most likely
 * to be empty — `rails_fired` when no rail fired, `unverified_fields` when everything verified — are
 * exactly the ones that break, which means the happy path breaks and the unhappy path works.
 *
 * The fix routes through jsonb, which encodes uniformly whether or not it has elements:
 *
 *   array(select jsonb_array_elements_text('["a","b"]'::jsonb))
 *
 * `PgTypes.array(values, elementOid)` is the driver's own answer, but it returns a `Result<Parameter>`
 * and needs an OID at the call site — more machinery than this, for the same outcome.
 */
import type { SqlClient } from "effect/sql"

export const textArray = (sql: SqlClient.SqlClient, values: ReadonlyArray<string>) =>
  sql`array(select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`
