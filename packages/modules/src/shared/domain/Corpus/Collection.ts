/**
 * Which corpus a document belongs to.
 *
 * In `shared/domain` because two slices both need it and neither owns it: `intake` writes it when a
 * document arrives, and `policy` filters on it inside the retrieval function. It started in
 * `intake/domain/Document` and `dep:check` caught the cross-slice import — correctly, because a type
 * two slices depend on is a shared type whether or not anyone decided that.
 *
 * The separation it expresses is the product's most important structural guarantee: **the policy
 * corpus is what decisions are justified against, and a transactional document must never be citable
 * as policy.** A supplier who can get an invoice indexed as policy can write their own approval rule.
 * So it is enforced three times over — a CHECK constraint on both tables, a filter inside
 * `retrieve_policy` (which is the only way to query the corpus), and this closed literal union, which
 * makes an unrecognised value a compile error rather than a row.
 */
import { Schema } from "effect"

/**
 * `knowledge` is technical documentation — manuals, schematics, service bulletins — for answering questions, as
 * a workshop's mechanics need. It is its OWN collection rather than more `policy`, for the same reason
 * transactional is: the decide pipeline justifies decisions against `policy` only, and a manual's "replace the
 * seal every 500 hours" must never be retrievable as an approval rule. Invoice decisions never search it.
 */
export const Collection = Schema.Literals(["policy", "transactional", "knowledge"])
export type Collection = typeof Collection.Type

/** What can be ASKED. Not `transactional`: an invoice is decided, never cited as an authority. */
export const AskableCollection = Schema.Literals(["policy", "knowledge"])
export type AskableCollection = typeof AskableCollection.Type
