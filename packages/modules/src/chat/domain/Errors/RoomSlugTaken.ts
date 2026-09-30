/**
 * A channel name that collides with one the organization already has.
 *
 * A typed refusal rather than a silent suffix. Discord appends nothing and neither does this: `#billing` and
 * `#billing-2` are two places people will post the same thing, and a tool that invents the second one has
 * chosen a confusing outcome on the user's behalf. Refusing tells them the channel already exists — which is
 * usually what they wanted to know.
 *
 * It carries the slug rather than the name, because the slug is what actually collided: "Billing" and
 * "billing" are the same channel.
 */
import { Schema } from "effect"

export class RoomSlugTaken extends Schema.TaggedError<RoomSlugTaken>()("RoomSlugTaken", {
  slug: Schema.String
}) {}
