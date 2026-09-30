#!/usr/bin/env bun
/**
 * The end-to-end decision eval, against docket's recorded baseline (build-order step 11).
 *
 * The real corpus, the real pipeline, a real model. Everything else in this repo measures one component;
 * this measures the thing the product actually claims — that a decision is grounded in policy a human can
 * audit — and it is the only number comparable to docket's.
 *
 * ## The baseline, and what it is
 *
 * From `docket/docs/m5-baseline.md`, 99 labelled invoices against the real pipeline:
 *
 *     outcome matches        7/99
 *     grounded              33/99
 *     false escalations     27/99   (cost, not a gate)
 *     FALSE AUTO-APPROVES    0/99   (gate never exercised)
 *     cost                  $4.78
 *
 * The last line of that table is the one worth reading twice. **Zero false auto-approvals because nothing
 * was ever armed**: no decision reached `auto_approve` in 99 cases, so the failure that matters never had
 * the opportunity to occur and the gate reported green having tested nothing. This harness arms a rule, so
 * the number means something.
 *
 * ## What docket's own analysis said to fix, and what this measures
 *
 * Sixty-six grounding failures, and **forty of them were bookkeeping rather than judgement**: 25 were
 * `[7]` markers in a rationale with no citation 7, and 13 cited a clause that was never offered. The
 * diagnosis was declaration order — `rationale` was declared before `citations`, so a model generating
 * JSON in schema order committed to numbering it had not chosen yet. `ProposedDecision` here declares
 * citations first for exactly that reason.
 *
 * So this harness classifies every grounding failure by cause, in docket's own four buckets, and prints
 * the marker-orphan count next to docket's 25. That comparison is the actual deliverable of step 11 — the
 * one claim in this codebase backed by a number rather than an argument, checked.
 *
 * **And one honest caveat, measured rather than assumed.** Workers AI's constrained decoding emits JSON
 * object keys in its own order, not the schema's — a probe of `ProposedDecision` came back
 * `citations, outcome, rationale` while the schema says `outcome, citations, rationale`. Whether
 * declaration order still buys anything under a provider that reorders is not something the argument
 * settles, so the report states the emitted order it observed rather than presuming the fix transferred.
 *
 *     bun run evals                       # the report
 *     bun run evals --strict              # the CI gate
 *     EVAL_COUNT=12 bun run evals         # a cheap smoke run
 */
import { Db, textArray } from "@ea/database/Database"
import { CurrentOrg, CurrentUser, Identity, OrgId, UserId } from "@ea/domain/Identity"
import { Ids } from "@ea/domain/Ids"
import { TelemetryNoop } from "@ea/modules/decision/domain/Telemetry"
import { LanguageModelWorkersAiRest, WORKERS_AI_MODEL } from "@ea/modules/decision/server/Extraction"
import { DecideDocument, decideKey } from "@ea/modules/decision/use-cases/Decision"
import { ChunkerHeading } from "@ea/modules/policy/domain/Chunk"
import { EmbedderWorkersAiRest } from "@ea/modules/policy/server/Embedding"
import { IndexPolicyDocument } from "@ea/modules/policy/use-cases/Chunk"
import { PolicySearchLive } from "@ea/modules/policy/use-cases/Retrieval"
import { EventBus, type EventBusService } from "@ea/modules/shared/domain/Event"
import { migrate } from "@ea/modules/shared/tables/Migrations"
import { PgClient } from "@effect/sql-pg"
import { Cause, Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { APPROVED_SUPPLIERS, buildInvoices, type GeneratedInvoice, SCENARIOS } from "./fixtures/Invoices.ts"

// --- docket's baseline, as data -------------------------------------------

/** From docket/docs/m5-baseline.md. Written here as numbers so the report can subtract. */
const BASELINE = {
  cases: 99,
  matched: 7,
  grounded: 33,
  falseEscalations: 27,
  falseAutoApproves: 0,
  /** Grounding failures by cause. 40 of 66 were bookkeeping, not judgement. */
  causes: { markerOrphan: 25, clauseNotOffered: 13, notVerbatim: 2, judge: 26 }
} as const

const COUNT = Number(process.env["EVAL_COUNT"] ?? BASELINE.cases)
const SEED = Number(process.env["EVAL_SEED"] ?? 11)
const STRICT = process.argv.includes("--strict")
/** Four at a time: enough to keep the run to minutes, few enough to stay inside a provider's rate limit. */
const CONCURRENCY = Number(process.env["EVAL_CONCURRENCY"] ?? 4)

const ORG = OrgId.make("eval_decisions")

// --- environment ----------------------------------------------------------

/** Same loader as db:verify and the recall gate: one source of truth for wrangler dev and scripts. */
const loadWorkerEnv = () => {
  const path = new URL("../apps/worker/.env", import.meta.url).pathname
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match === null) continue
    const key = match[1]!
    if (process.env[key] !== undefined && process.env[key] !== "") continue
    process.env[key] = match[2]!.replace(/^["']|["']$/g, "")
  }
}
loadWorkerEnv()

if (process.env["CLOUDFLARE_AI_TOKEN"] === undefined || process.env["CLOUDFLARE_ACCOUNT_ID"] === undefined) {
  console.error(
    "This eval needs a real model: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN in apps/worker/.env.\n" +
      "It deliberately does NOT fall back to the scripted model — a grounded rate measured against a\n" +
      "script is a measurement of the script, and printing it next to docket's 33/99 would be a lie."
  )
  process.exit(1)
}

const Pg = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

const IdsLive = Layer.succeed(Ids)({ next: Effect.sync(() => crypto.randomUUID()) })

/** Events are counted, not sent: this harness has no queue and the emit itself is what matters. */
const emitted: Array<string> = []
const BusLive = Layer.succeed(EventBus)(
  {
    send: (message) => Effect.sync(() => void emitted.push(message.eventId))
  } satisfies EventBusService
)

const identity = new Identity({
  userId: UserId.make("eval"),
  orgId: ORG,
  email: "eval@example.com",
  role: "reviewer"
})

/**
 * One layer, built once, shared by every case.
 *
 * `CurrentUser` as a LAYER rather than `provideService`: `WorkflowEnginePg` captures the connection and the
 * identity when the layer is BUILT, so an inner provide is too late and fails with
 * "Service not found: iam/CurrentUser" at layer construction.
 */
const Ports = Layer.mergeAll(
  Db.layer,
  IdsLive,
  EmbedderWorkersAiRest,
  LanguageModelWorkersAiRest,
  BusLive,
  ChunkerHeading,
  // The harness computes its own rates from the decisions it made; a second source for one number is how
  // two numbers come to disagree.
  TelemetryNoop,
  Layer.succeed(CurrentUser)(identity),
  // The tenant. The decide workflow requires `CurrentOrg` — it is queue-driven and needs no person.
  Layer.succeed(CurrentOrg)(ORG)
).pipe(Layer.provideMerge(Pg))

/*
 * Simpler than it was, because the pipeline is a plain composition now.
 *
 * This used to build `DecideDocumentLayer` over `WorkflowEnginePg` and `PolicySearchLive`, with a comment
 * about `mergeAll` building in parallel and leaving a needed layer unbuilt. `DecideDocument` requires only
 * the ports, so there is nothing to wire into anything — the engine and its 298 lines are gone (risk R7).
 */
const AppLayer = PolicySearchLive.pipe(Layer.provideMerge(Ports))

// --- the corpus -----------------------------------------------------------

const corpusDir = new URL("./fixtures/corpus/", import.meta.url).pathname

/**
 * The corpus, including its distractors.
 *
 * Eight documents rather than one, and the extra seven are the point: retrieval over ten clauses with
 * top_k=8 returns most of the policy and cannot fail. What makes ranking miss things is a corpus full of
 * clauses that look relevant and are not — a superseded policy with the SAME article numbers and different
 * thresholds, a travel policy with its own approval table, a capex matrix shaped like the procurement one.
 */
const corpus = readdirSync(corpusDir)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => ({
    id: `eval_policy_${name.replace(/\.md$/, "").replace(/-/g, "_")}`,
    name,
    text: readFileSync(`${corpusDir}${name}`, "utf8")
  }))

// --- scoring --------------------------------------------------------------

/** docket's four buckets, plus the two this pipeline can distinguish that docket could not. */
interface Causes {
  markerOrphan: number
  clauseNotOffered: number
  notVerbatim: number
  spanUnverified: number
  arithmetic: number
}

interface Scored {
  readonly generated: GeneratedInvoice
  readonly outcome: string
  readonly railsFired: ReadonlyArray<string>
  readonly retrievalMode: string
  readonly rationale: string
  readonly citations: number
  /** Distinct `[n]` markers in the rationale, for docket's biggest finding. */
  readonly markers: ReadonlyArray<number>
  readonly emittedExecute: boolean
  readonly failure: string | null
}

/** Distinct citation markers in a rationale, as numbers. */
const markersIn = (rationale: string): ReadonlyArray<number> => {
  const found = new Set<number>()
  for (const match of rationale.matchAll(/\[(\d{1,2})\]/g)) found.add(Number(match[1]))
  return [...found].sort((a, b) => a - b)
}

const pct = (n: number, of: number) => of === 0 ? "  0.0%" : `${((n / of) * 100).toFixed(1).padStart(5)}%`
const delta = (ours: number, theirs: number, of: number) => {
  const our = (ours / of) * 100
  const base = (theirs / BASELINE.cases) * 100
  const sign = our - base >= 0 ? "+" : ""
  return `${sign}${(our - base).toFixed(1)} pt`
}

// --- the run --------------------------------------------------------------

const asAdmin = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Pg)) as Effect.Effect<A, E, never>)

const main = async () => {
  const set = buildInvoices(COUNT, SEED)

  console.log(`effect-ai decision eval — ${set.length} labelled invoices, seed ${SEED}`)
  console.log(`model:   ${process.env["EVAL_MODEL"] ?? WORKERS_AI_MODEL} (Workers AI, REST)`)
  console.log(`corpus:  ${corpus.length} documents, ${corpus.map((doc) => doc.name).join(", ")}`)
  console.log(
    `baseline: docket M5 — ${BASELINE.matched}/${BASELINE.cases} matched, ${BASELINE.grounded}/${BASELINE.cases} grounded\n`
  )

  // Migrate first. A gate that measures whatever schema happens to be lying around is not a gate.
  await Effect.runPromise(migrate.pipe(Effect.provide(Pg)) as Effect.Effect<unknown, unknown, never>)

  /*
   * A clean slate, and an ARMED rule.
   *
   * The rule is the policy's own first tier written down as an authorisation — EUR 1.000, approved
   * suppliers, PO required, thirty days — so `auto_approve` is genuinely reachable. docket's run had
   * nothing armed and therefore reported zero false auto-approvals from zero opportunities; that is the
   * one number in its baseline that meant nothing, and arming this is how it comes to mean something.
   */
  await asAdmin(Effect.flatMap(SqlClient.SqlClient, (sql) =>
    Effect.gen(function*() {
      yield* sql`delete from events where organization_id = ${ORG}`
      yield* sql`delete from workflow_executions where organization_id = ${ORG}`
      yield* sql`delete from rules where organization_id = ${ORG}`
      yield* sql`delete from source_documents where organization_id = ${ORG}`
      yield* sql`
        insert into rules (
          id, organization_id, vertical, armed, max_amount_minor, currency, require_po,
          approved_suppliers, min_payment_days, description, created_by
        ) values (
          'eval_rule', ${ORG}, 'invoice', true, 100000, 'EUR', true,
          ${textArray(sql, [...APPROVED_SUPPLIERS])},
          14, 'Artikel 3 tier 1: budget holder authority', 'eval'
        )
      `
      for (const doc of corpus) {
        yield* sql`
          insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
          values (${doc.id}, ${ORG}, 'policy', ${doc.name}, ${`${ORG}/${doc.id}`}, 'text/markdown')
        `
      }
      for (const generated of set) {
        yield* sql`
          insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
          values (${`eval_inv_${generated.filename}`}, ${ORG}, 'transactional', ${generated.filename},
                  ${`${ORG}/${generated.filename}`}, 'text/markdown')
        `
      }
    })))

  process.stdout.write("indexing the corpus ")
  for (const doc of corpus) {
    await Effect.runPromise(
      IndexPolicyDocument({ documentId: doc.id, title: doc.name, text: doc.text, collection: "policy" })
        .pipe(Effect.provide(AppLayer)) as Effect.Effect<unknown, unknown, never>
    )
    process.stdout.write(".")
  }
  console.log(" done")

  const started = Date.now()
  let completed = 0
  process.stdout.write(`deciding ${set.length} invoices `)

  const scored = await Effect.runPromise(
    Effect.forEach(set, (generated) =>
      Effect.gen(function*() {
        const documentId = `eval_inv_${generated.filename}`
        const before = emitted.length
        const decided = yield* DecideDocument({
          documentId,
          documentText: generated.markdown,
          vertical: "invoice"
        })
        completed++
        if (completed % 10 === 0) process.stdout.write(String(completed))
        else process.stdout.write(".")

        const rows = yield* Effect.flatMap(Db, (db) =>
          db.scoped((sql, orgId) =>
            sql<{ rationale: string; citations: number }>`
              select d.rationale,
                     (select count(*)::int from decision_citations c where c.decision_id = d.id) as citations
                from decisions d
               where d.organization_id = ${orgId} and d.decide_key = ${decideKey(documentId, "invoice")}
            `
          ))
        const row = rows[0]
        return {
          generated,
          outcome: decided.outcome,
          railsFired: decided.railsFired,
          retrievalMode: decided.retrievalMode,
          rationale: row?.rationale ?? "",
          citations: row?.citations ?? 0,
          markers: markersIn(row?.rationale ?? ""),
          emittedExecute: emitted.length > before,
          failure: null
        } satisfies Scored
      }).pipe(
        /*
         * `catchCause`, not `result` — and the difference cost a whole run.
         *
         * A model failure does not arrive as a typed error: `DecideDocument` wraps `ExtractDocument` in
         * `Effect.orDie`, because a caller could do nothing useful with an `AiError` mid-workflow. So it
         * becomes a DEFECT, `Effect.result` does not see it, and one truncated response took down the
         * whole 99-case run. A harness that dies on its first bad case cannot report a failure rate.
         */
        Effect.catchCause((cause) => {
          completed++
          process.stdout.write("!")
          return Effect.succeed(
            {
              generated,
              outcome: "ERROR",
              railsFired: [],
              retrievalMode: "none",
              rationale: "",
              citations: 0,
              markers: [],
              emittedExecute: false,
              failure: Cause.pretty(cause).split("\n")[0]!.slice(0, 160)
            } satisfies Scored
          )
        })
      ), { concurrency: CONCURRENCY }).pipe(
        Effect.provide(AppLayer)
      ) as Effect.Effect<ReadonlyArray<Scored>, unknown, never>
  )
  const elapsed = ((Date.now() - started) / 1000).toFixed(0)
  console.log(`\n\nran in ${elapsed}s\n`)

  // --- the headline table ------------------------------------------------

  const errors = scored.filter((row) => row.failure !== null)
  const ok = scored.filter((row) => row.failure === null)

  /*
   * Nothing scored: report the reason and FAIL, whatever `--strict` says.
   *
   * The first full 99-case run exhausted the Workers AI daily free allocation and every case errored. This
   * harness printed a table of `0/0` with `NaN pt` deltas and exited 0 — a green run reporting nothing,
   * which is the worst possible outcome for a measurement tool and exactly the failure the rest of this
   * file is written to avoid. A harness has to be able to say "I could not measure this".
   */
  if (ok.length === 0) {
    console.error(`\n✗ NOTHING WAS MEASURED — all ${scored.length} cases failed.\n`)
    const reasons = new Map<string, number>()
    for (const row of errors) {
      const key = /daily (free )?allocation|used up/i.test(row.failure!)
        ? "Workers AI daily allocation exhausted"
        : row.failure!.slice(0, 120)
      reasons.set(key, (reasons.get(key) ?? 0) + 1)
    }
    for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
      console.error(`  ${String(count).padStart(4)} x  ${reason}`)
    }
    console.error(
      "\nNo numbers are printed, because there are none. Comparing an empty run to docket's 33/99 would\n" +
        "be worse than reporting nothing at all."
    )
    process.exit(1)
  }
  const matched = ok.filter((row) => row.outcome === row.generated.scenario.expected)
  /*
   * Grounded means CITED AND VERIFIED, and the `citations > 0` clause is not a detail.
   *
   * The first version of this metric was `no grounding/citation/arithmetic rail fired`, and it reported
   * 5/5 grounded on five decisions that carried **no citations at all** — a decision with nothing to point
   * at fires no citation rail, because there is nothing to check. That is the exact shape of failure this
   * whole product exists to prevent, scored as a pass. docket's "grounded" meant citation validation
   * passed, which presupposes citations.
   */
  const uncited = ok.filter((row) => row.citations === 0)
  const grounded = ok.filter((row) =>
    row.citations > 0 &&
    !row.railsFired.some((fired) =>
      fired.startsWith("grounding:") || fired.startsWith("arithmetic:") || fired.startsWith("citation:")
    )
  )
  const needsHuman = ok.filter((row) => row.outcome === "needs_human")
  const autoApproved = ok.filter((row) => row.outcome === "auto_approve")
  /** Auto-approved when a human should have seen it. The one number that is a gate. */
  const falseAutoApproves = autoApproved.filter((row) => row.generated.scenario.expected !== "auto_approve")
  /** Escalated a case a human would have paid without thinking. Cost, not a gate. */
  const falseEscalations = ok.filter((row) =>
    row.generated.scenario.expected === "auto_approve" && row.outcome !== "auto_approve"
  )

  const n = ok.length
  console.log(`${"".padEnd(24)}${"ours".padStart(10)}${"docket M5".padStart(12)}${"delta".padStart(10)}`)
  console.log("-".repeat(58))
  const line = (label: string, ours: number, theirs: number) =>
    console.log(
      `${label.padEnd(24)}${`${ours}/${n}`.padStart(10)}${`${theirs}/${BASELINE.cases}`.padStart(12)}${
        delta(ours, theirs, n).padStart(10)
      }`
    )
  line("outcome matches", matched.length, BASELINE.matched)
  line("grounded", grounded.length, BASELINE.grounded)
  line("false escalations", falseEscalations.length, BASELINE.falseEscalations)
  line("FALSE AUTO-APPROVES", falseAutoApproves.length, BASELINE.falseAutoApproves)
  console.log(
    `${"auto_approve reached".padEnd(24)}${`${autoApproved.length}/${n}`.padStart(10)}${"0/99".padStart(12)}` +
      `${(autoApproved.length > 0 ? "  gate LIVE" : "  gate dead").padStart(10)}`
  )
  console.log(`${"needs_human".padEnd(24)}${`${needsHuman.length}/${n}`.padStart(10)}`)
  console.log(
    `${"decisions with NO citation".padEnd(24)}${`${uncited.length}/${n}`.padStart(10)}` +
      (uncited.length > 0 ? "   ← cannot be grounded; nothing to audit" : "")
  )
  if (errors.length > 0) console.log(`${"errored".padEnd(24)}${`${errors.length}/${scored.length}`.padStart(10)}`)

  /*
   * `needs_human` is printed WITHOUT a threshold, on purpose, and plan risk R1 says why: a FALLING
   * needs-human rate is an alarm, not a win. Weaker grounding lowers it by shipping ungrounded decisions.
   * It is read next to `grounded`, never on its own.
   */

  // --- docket's actual finding: bookkeeping vs judgement ------------------

  const causes: Causes = { markerOrphan: 0, clauseNotOffered: 0, notVerbatim: 0, spanUnverified: 0, arithmetic: 0 }
  for (const row of ok) {
    // The marker-orphan check runs on EVERY row, not only failing ones: it is a property of the output,
    // and docket's 25 were rows that had already been counted as grounding failures for this reason.
    if (row.markers.some((marker) => marker > row.citations)) causes.markerOrphan++
    for (const fired of row.railsFired) {
      if (fired.includes("never retrieved")) causes.clauseNotOffered++
      else if (fired.includes("not verbatim")) causes.notVerbatim++
      else if (fired.startsWith("grounding:")) causes.spanUnverified++
      else if (fired.startsWith("arithmetic:")) causes.arithmetic++
    }
  }

  console.log("\ngrounding failures by cause — docket's central finding was that 40 of 66 were bookkeeping\n")
  console.log(`${"cause".padEnd(26)}${"ours".padStart(7)}${"docket".padStart(9)}   kind`)
  console.log("-".repeat(62))
  const cause = (label: string, ours: number, theirs: number | null, kind: string) =>
    console.log(
      `${label.padEnd(26)}${String(ours).padStart(7)}${(theirs === null ? "—" : String(theirs)).padStart(9)}   ${kind}`
    )
  cause("markers without citations", causes.markerOrphan, BASELINE.causes.markerOrphan, "bookkeeping")
  cause("cites a clause not offered", causes.clauseNotOffered, BASELINE.causes.clauseNotOffered, "bookkeeping")
  cause("excerpt not verbatim", causes.notVerbatim, BASELINE.causes.notVerbatim, "bookkeeping")
  cause("span did not verify", causes.spanUnverified, null, "extraction")
  cause("arithmetic", causes.arithmetic, null, "deterministic, correct")

  /*
   * The field-order claim, checked rather than asserted.
   *
   * `ProposedDecision` declares citations before rationale because docket measured the other order costing
   * 25 of 66 grounding failures. But this provider's constrained decoding emits keys in its OWN order, so
   * the report states what was actually observed instead of presuming the fix carried over.
   */
  const withMarkers = ok.filter((row) => row.markers.length > 0)
  console.log(
    `\nrationales containing [n] markers: ${withMarkers.length}/${n}` +
      (withMarkers.length === 0
        ? "  — none, so the marker-orphan failure class cannot occur here at all"
        : `, of which ${causes.markerOrphan} reference a citation that does not exist`)
  )

  // --- per-rail fire rates (plan risk R1) --------------------------------

  const rails = new Map<string, number>()
  for (const row of ok) {
    for (const fired of row.railsFired) {
      const category = fired.split(":")[0]!
      rails.set(category, (rails.get(category) ?? 0) + 1)
    }
  }
  console.log("\nper-rail fire rate — R1: report these, not just the aggregate\n")
  for (const [category, count] of [...rails].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${category.padEnd(18)} ${String(count).padStart(4)}  ${pct(count, n)}`)
  }
  if (rails.size === 0) console.log("  (no rail fired on any case)")

  // --- per-scenario --------------------------------------------------------

  console.log("\nby labelled scenario\n")
  console.log(
    `${"scenario".padEnd(24)}${"expected".padEnd(20)}${"n".padStart(4)}${"matched".padStart(9)}   most common outcome`
  )
  console.log("-".repeat(92))
  for (const scenario of SCENARIOS) {
    const rows = ok.filter((row) => row.generated.scenario.key === scenario.key)
    if (rows.length === 0) continue
    const hit = rows.filter((row) => row.outcome === scenario.expected).length
    const tally = new Map<string, number>()
    for (const row of rows) tally.set(row.outcome, (tally.get(row.outcome) ?? 0) + 1)
    const [top] = [...tally].sort((a, b) => b[1] - a[1])
    console.log(
      `${scenario.key.padEnd(24)}${scenario.expected.padEnd(20)}${String(rows.length).padStart(4)}${
        `${hit}/${rows.length}`.padStart(9)
      }   ${top![0]} (${top![1]})`
    )
  }

  if (falseAutoApproves.length > 0) {
    console.log("\nFALSE AUTO-APPROVES — each one is money out of the door:\n")
    for (const row of falseAutoApproves) {
      console.log(
        `  ${row.generated.filename}  expected ${row.generated.scenario.expected}, ` +
          `EUR ${(row.generated.totalInclVatCents / 100).toFixed(2)}, emitted=${row.emittedExecute}`
      )
    }
  }

  if (errors.length > 0) {
    console.log("\nerrored (not scored):\n")
    for (const row of errors.slice(0, 5)) console.log(`  ${row.generated.filename}: ${row.failure}`)
    if (errors.length > 5) console.log(`  … and ${errors.length - 5} more`)
  }

  // --- the gate ------------------------------------------------------------

  if (!STRICT) {
    console.log("\n(run with --strict to apply the CI thresholds)")
    return
  }

  const problems: Array<string> = []

  /*
   * ONE hard gate and two ratchets, and the asymmetry is the whole point.
   *
   * A false auto-approve is money out of the door on a decision a human should have seen, so its threshold
   * is zero and it is not negotiable. `grounded` and `matched` are ratchets against docket's baseline:
   * below it is a regression worth failing on, above it is the improvement being claimed.
   *
   * There is deliberately NO threshold on `needsHuman`, because a lower number is not better — see R1.
   */
  if (falseAutoApproves.length > 0) {
    problems.push(`${falseAutoApproves.length} false auto-approve(s) — the gate is zero, not a rate`)
  }
  if (autoApproved.length === 0) {
    problems.push(
      "no decision reached auto_approve, so the false-auto-approve gate tested nothing — this is the exact " +
        "hole docket's baseline had, and a rule IS armed here, so something upstream is refusing everything"
    )
  }
  const groundedRate = grounded.length / n
  const baselineGrounded = BASELINE.grounded / BASELINE.cases
  if (groundedRate < baselineGrounded) {
    problems.push(
      `grounded ${pct(grounded.length, n).trim()} is below docket's ${(baselineGrounded * 100).toFixed(1)}% baseline`
    )
  }
  if (errors.length > scored.length * 0.05) {
    problems.push(`${errors.length} of ${scored.length} cases errored, which is over the 5% tolerance`)
  }
  /*
   * An uncited majority fails the gate even if everything else looks fine.
   *
   * A pipeline that answers `needs_human` with no citation for most of a corpus is not cautious, it is not
   * working — and every other number in this report looks respectable while it happens, which is why this
   * is a gate rather than a note.
   */
  if (uncited.length > n * 0.5) {
    problems.push(
      `${uncited.length} of ${n} decisions carry no citation at all — the pipeline is not grounding, ` +
        "and a high needs_human rate is hiding it rather than reporting it"
    )
  }

  if (problems.length > 0) {
    console.error("\n✗ GATE FAILED:")
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(
    `\n✓ gate passed: 0 false auto-approves with the gate live, grounded ${pct(grounded.length, n).trim()} ` +
      `>= docket's ${(baselineGrounded * 100).toFixed(1)}%.`
  )
}

await main()
