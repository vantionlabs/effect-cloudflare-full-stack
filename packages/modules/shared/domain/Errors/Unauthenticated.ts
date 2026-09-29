/**
 * No session. The RPC transport's refusal.
 *
 * A plain tagged failure rather than `HttpApiError.Unauthorized`: RPC has no status codes, and the
 * transport's own 401 is not something an RPC client can act on differently. Distinguishing "no session"
 * from "expired" from "unknown user" is a probing oracle while the client's remedy is identical, so the
 * payload is deliberately empty.
 */
import { Schema } from "effect"

export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()("Unauthenticated", {}) {}
