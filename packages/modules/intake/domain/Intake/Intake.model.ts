/**
 * The intake model.
 *
 * Separate concept from `Document` because they answer different questions. A document is a thing
 * that exists; an intake is an *event* that happened — the same file can arrive twice, by
 * different routes, and the audit trail should say so rather than silently deduplicate.
 */
import { Schema } from "effect"

export const IntakeId = Schema.String.pipe(Schema.brand("IntakeId"))
export type IntakeId = typeof IntakeId.Type

/** How a document arrived. A closed set: an unrecognised source must not be storable, because
 * the audit trail is only as good as its vocabulary. Mirrors the CHECK constraint on `intakes`. */
export const IntakeSource = Schema.Literals(["upload", "webhook", "schedule", "email"])
export type IntakeSource = typeof IntakeSource.Type
