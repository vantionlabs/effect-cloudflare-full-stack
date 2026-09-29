/**
 * The product's own numbers, as a port.
 *
 * **Not a general metrics API, and deliberately so.** There is one method per thing worth asking about, with
 * a typed shape — `decision(...)`, not `counter(name).increment()`. A generic API would let any caller emit
 * anything, and then the question "what does this system report?" is answered by grepping call sites rather
 * than by reading one interface.
 *
 * ## Why this exists alongside spans, rather than instead of them
 *
 * Spans already cover the *mechanics*: `Activity` wraps every workflow step in `Effect.withSpan`,
 * `effect/sql` traces queries, `effect/ai`'s `LanguageModel` traces model calls, and `RpcServer` traces
 * requests. So latency and causality come free the moment a `Tracer` is provided — `effect/observability`'s
 * `Otlp.layer` does it in one line and needs no OpenTelemetry SDK.
 *
 * What spans do NOT give is the thing this product is actually judged on: **how often it refuses, and
 * whether its refusals are grounded.** That is a rate over decisions, not a duration over calls, and it is
 * the number a client asks about.
 *
 * ## The one rule for reading these numbers (plan risk R1)
 *
 * **A falling `needsHuman` rate is an alarm, not a win.** Honest behaviour under poor retrieval is to
 * escalate everything — correct, and indistinguishable from failure. The mirror is worse: weaker grounding
 * *lowers* escalation by shipping ungrounded decisions. So `needsHuman` is never reported on its own; it is
 * read beside `grounded`, and both are read beside the per-rail fire rates that say which mechanism acted.
 *
 * Every field below exists to make that reading possible from stored data rather than from a guess.
 *
 * ## Why this lives in `decision` and not in `shared`
 *
 * It was written in `shared/domain/Telemetry` first, and that was wrong: `DecisionObservation` needs
 * `Outcome`, which is the decision slice's vocabulary, so `shared` would have had to import from a slice and
 * invert the dependency direction the whole layout rests on. `dep:check` enumerates that as a slice-isolation
 * violation. The port is decision-shaped, so it belongs to decision — and if a second slice ever needs
 * telemetry, it gets its own port rather than a generic one that could emit anything.
 */
import type { RetrievalMode } from "@ea/modules/shared/domain/Retrieval"
import { Context, Effect, Layer } from "effect"
import type { Outcome } from "../Decision/Decision.ts"

/**
 * One decision, as the thing an operator queries.
 *
 * Flat on purpose: it maps to a single row, and a nested shape would have to be flattened by every adapter
 * in the same way, which is a decision better made once here.
 */
export interface DecisionObservation {
  readonly vertical: string
  readonly outcome: Outcome
  /** Which rails fired, by CATEGORY (`grounding`, `arithmetic`, `citation`, `amount`, …). The full message
   * names a specific span or clause, which is right for a reviewer and useless for a rate. */
  readonly railsFired: ReadonlyArray<string>
  /** An input to rail 4 and a leading indicator: a drift from `hybrid` to `lexical` silently disarms
   * auto-approval, and nothing else in the system would report it. */
  readonly retrievalMode: RetrievalMode
  readonly grounded: boolean
  /** Zero means the decision cannot be audited, whatever its outcome says. */
  readonly citations: number
  /** Undefined when the provider did not report usage, which is not the same as zero. */
  readonly inputTokens: number | undefined
  readonly outputTokens: number | undefined
  readonly durationMillis: number
  /** True when this replayed an existing decision. Replays must not be counted in any rate. */
  readonly replayed: boolean
}

export interface TelemetryService {
  readonly decision: (observation: DecisionObservation) => Effect.Effect<void>
}

export class Telemetry extends Context.Service<Telemetry, TelemetryService>()("decision/Telemetry") {}

/**
 * Discards every observation.
 *
 * The default for tests and for the eval harness, and safe as a default for exactly one reason: **nothing
 * reads telemetry back.** It is write-only by construction — no method returns a value — so a test cannot
 * pass or fail differently for having a real adapter. The moment something queries these numbers in-process,
 * this stops being a safe default and the tests that relied on it start lying.
 *
 * The eval harness uses this rather than a recording adapter on purpose: it computes the same rates from the
 * decisions it just made, and two sources for one number is how they come to disagree.
 */
export const TelemetryNoop: Layer.Layer<Telemetry> = Layer.succeed(Telemetry)({
  decision: () => Effect.void
})
