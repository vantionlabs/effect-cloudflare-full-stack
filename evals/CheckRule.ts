#!/usr/bin/env bun
/**
 * What the rails still stop when the model is maximally wrong.
 *
 * Ported from docket's `evals/check_rule.py`. Every other measurement in this repo asks how good the
 * model is. This one assumes the model is as wrong as it can be and asks what is left:
 *
 *     if the model proposed auto_approve for EVERY invoice in the labelled set, including the
 *     deliberate nasties, which of them would the rails still stop?
 *
 * That is defence in depth stated as an experiment. A rail whose safety rests on the model being right
 * is not a gate, it is a formality — the rails exist precisely because the model is a component that
 * fails. Running the real rails against the real labelled set under the worst assumption about the
 * model says what they are worth on their own.
 *
 * **No model, no database, no network, no bindings.** Milliseconds. That is only possible because the
 * rails are a pure function and the two model-free checks are pure functions, which is the property
 * `applyRails`'s unconstructible brand exists to protect.
 *
 * ## How the model is mocked, and why not more harshly
 *
 * The proposal is `auto_approve` with **one properly formed citation**: verbatim text, quoting a chunk
 * that was actually retrieved. A clumsier mock — no citations, or a fabricated quote — would be
 * stopped by rails 2 and the report would credit the rules with work the citation rail had already
 * done. The worst case that matters is a model that is confidently, articulately wrong.
 *
 * `retrievalMode` is `hybrid`, so rail 4 is given no credit either — degraded retrieval is a real reason
 * to refuse automatic approval, and it would flatter the rules to count it.
 *
 * Rail 3 IS given its due, because it is the subject: a real `AutoApproveRule` is evaluated by the real
 * `evaluateRule` against facts mapped by the same function the pipeline uses. The question is not "do the
 * rails stop things" — it is "which mechanism stops each labelled nasty", and a rule's bounds are one of
 * the mechanisms under examination.
 *
 *     bun run evals:rule              # the report
 *     bun run evals:rule --strict     # the CI gate: exits non-zero if a nasty is released
 */
import { applyRails } from "@ea/modules/decision/domain/Decision"
import { verifySpans } from "@ea/modules/decision/domain/Extraction"
import { checkArithmetic, invoiceRuleFacts } from "@ea/modules/decision/domain/Invoice"
import { AutoApproveRule, evaluateRule } from "@ea/modules/decision/domain/Rule"
import {
  APPROVED_SUPPLIERS,
  buildInvoices,
  type GeneratedInvoice,
  MUST_NOT_AUTO_APPROVE,
  SCENARIOS
} from "./fixtures/Invoices.ts"

const COUNT = Number(process.env["EVAL_COUNT"] ?? 300)
const SEED = Number(process.env["EVAL_SEED"] ?? 11)
const STRICT = process.argv.includes("--strict")

/**
 * The rule under test: the one a Dutch SME would plausibly arm first.
 *
 * EUR 1.000 is the budget holder's own limit from `corpus/inkoopbeleid-2026.md` Artikel 3, PO required
 * per Artikel 2, the approved supplier list per Artikel 4, and thirty days per Artikel 5. So this is not
 * an invented rule — it is the policy's own first tier, written down as an authorisation.
 */
const RULE = new AutoApproveRule({
  id: "rule_under_test",
  vertical: "invoice",
  armed: true,
  max_amount_minor: 100_000,
  currency: "EUR",
  require_po: true,
  approved_suppliers: APPROVED_SUPPLIERS,
  min_payment_days: 14,
  description: "Artikel 3 tier 1: budget holder authority, EUR 1.000, approved suppliers, PO required."
})

/**
 * Scenarios the rails knowingly do NOT stop, with the mechanism that would and where it lands.
 *
 * This is a ratchet, not a silenced test. `--strict` fails on any released scenario that is not listed
 * here, AND fails when a listed scenario turns out to be stopped after all — because then the entry is
 * stale and deleting it is the point. Neither direction can drift unnoticed.
 */
const KNOWN_UNGATED: ReadonlyMap<string, string> = new Map([
  [
    "duplicate_invoice",
    "needs `document_fingerprints` (plan slice 1: \"turns docket's SELECT-then-decide duplicate check " +
    "into a constraint\"). A duplicate is a property of the CORPUS, not of the invoice in front of you, " +
    "so no pure rule condition can decide it and this harness must not pretend one does."
  ]
])

/**
 * The retrieved chunk the mocked citation points at, and the excerpt it quotes.
 *
 * Real text from the corpus, so the verbatim check does real work rather than comparing a placeholder
 * to itself. If this ever stopped matching `corpus/inkoopbeleid-2026.md` the citation rail would fire
 * on every case and the report would be meaningless — so the assertion below checks it.
 */
const CHUNK_ID = "chunk_artikel_3"
const CHUNK_CONTENT = "Tot en met EUR 1.000: de budgethouder mag goedkeuren. Boven EUR 1.000 tot en met EUR 2.500: " +
  "een afdelingshoofd mag goedkeuren."
const EXCERPT = "de budgethouder mag goedkeuren"

interface Row {
  seen: number
  released: number
  readonly examples: Array<string>
  /** Which rails fired, and how often, across the cases this scenario contributed. */
  readonly rails: Map<string, number>
}

/**
 * Runs the labelled set through the real rails with the model's proposal mocked to its worst value.
 *
 * Rail 1's inputs are the REAL check reports — `verifySpans` against the document the generator printed,
 * and `checkArithmetic` on the extracted fields — so this is the pipeline's own input and not a stand-in.
 */
const worstCase = (set: ReadonlyArray<GeneratedInvoice>): Map<string, Row> => {
  const results = new Map<string, Row>(
    SCENARIOS.map((scenario) => [scenario.key, { seen: 0, released: 0, examples: [], rails: new Map() }])
  )

  for (const generated of set) {
    const verification = verifySpans(generated.fields, generated.markdown)
    const arithmetic = checkArithmetic(generated.fields)

    const railed = applyRails({
      proposal: {
        outcome: "auto_approve",
        citations: [{ chunk_id: CHUNK_ID, clause_ref: "Artikel 3", excerpt: EXCERPT }],
        rationale: "(the model is assumed to be wrong)"
      },
      unverifiedSpans: verification.unverified,
      arithmeticFailures: arithmetic.failures,
      chunkContent: new Map([[CHUNK_ID, CHUNK_CONTENT]]),
      // The REAL evaluator against the REAL rule, on facts mapped by the same function the pipeline
      // uses. Nothing here is a stand-in for rail 3 — it IS rail 3's input.
      ruleUnmet: evaluateRule(RULE, invoiceRuleFacts(generated.fields)),
      retrievalMode: "hybrid"
    })

    const row = results.get(generated.scenario.key)!
    row.seen++
    for (const fired of railed.railsFired) {
      // Keyed by the rail's category, not its full message: the message names the specific span or
      // clause, which is right for a reviewer and useless for a tally.
      const category = fired.split(":")[0]!
      row.rails.set(category, (row.rails.get(category) ?? 0) + 1)
    }
    if (railed.outcome === "auto_approve") {
      row.released++
      if (row.examples.length < 3) {
        row.examples.push(
          `${generated.invoiceNumber} (${generated.currency} ${(generated.totalInclVatCents / 100).toFixed(2)}${
            generated.poNumber === null ? ", no PO" : ""
          })`
        )
      }
    }
  }

  return results
}

const pad = (text: string, width: number) => text.padEnd(width)

const main = () => {
  const set = buildInvoices(COUNT, SEED)

  /*
   * The mocked citation must be verbatim in the mocked chunk, or rail 2 fires on every case and this
   * script silently reports that the rails stop everything. Asserted rather than assumed, because a
   * harness that passes for the wrong reason is worse than one that fails.
   */
  if (!CHUNK_CONTENT.includes(EXCERPT)) {
    console.error("the mocked citation is not verbatim in the mocked chunk — fix this file, not the rails")
    process.exit(1)
  }

  console.log(`${COUNT} labelled invoices, seed ${SEED}, real rails, real model-free checks.`)
  console.log("assuming the model proposes auto_approve for every one of them, with a valid citation,")
  console.log("an armed rule, and hybrid retrieval — so rails 2, 3 and 4 are given no credit.\n")

  const results = worstCase(set)
  const escaped: Array<string> = []

  console.log(
    `${pad("labelled scenario", 24)}${pad("correct outcome", 20)}${"seen".padStart(5)}${
      "released".padStart(10)
    }  stopped by`
  )
  console.log("-".repeat(96))

  for (const scenario of SCENARIOS) {
    const row = results.get(scenario.key)!
    if (row.seen === 0) continue
    const mustStop = MUST_NOT_AUTO_APPROVE.has(scenario.key)
    let stoppedBy: string
    if (mustStop && row.released > 0) {
      escaped.push(scenario.key)
      /*
       * "Partly" is the label that needs care. It does NOT mean the mechanism works most of the time —
       * it means the cases that were stopped were stopped by something UNRELATED. A duplicate invoice
       * inherits the earlier invoice's supplier and amount, so most duplicates happen to breach the
       * ceiling or the supplier list as well; the ones that get through are the ones that look clean on
       * every axis the rails can see. Reading "19/20 stopped" as coverage would be exactly backwards.
       */
      stoppedBy = row.released === row.seen
        ? "NOTHING — the rails trust the model here"
        : `only incidentally (${row.seen - row.released}/${row.seen}, by unrelated bounds)`
    } else if (mustStop) {
      // Name the rail rather than saying "the rails": which mechanism caught it is the whole point.
      stoppedBy = [...row.rails.keys()].sort().join(" + ") || "(released nothing, but no rail fired?)"
    } else {
      stoppedBy = "(correctly released)"
    }
    console.log(
      `${pad(scenario.key, 24)}${pad(scenario.expected, 20)}${String(row.seen).padStart(5)}${
        String(row.released).padStart(10)
      }  ${stoppedBy}`
    )
  }

  /*
   * The false-positive side, printed always.
   *
   * A rail set that stops everything passes the gate and is worthless: the product's whole problem is
   * that honest caution and broken retrieval look identical from outside. So the clean cases get their
   * own line, and a number below 100% here is as much a finding as a released nasty.
   */
  const clean = results.get("clean_under_threshold")!
  const releaseRate = clean.seen === 0 ? 0 : clean.released / clean.seen
  console.log(
    `\nclean cases released: ${clean.released}/${clean.seen} (${(releaseRate * 100).toFixed(1)}%)` +
      (releaseRate === 1 ? "" : "  ← rails are stopping cases a human would have paid without thinking")
  )

  if (escaped.length > 0) {
    console.log("\nThese labelled nasties reach auto_approve when the model is wrong:\n")
    for (const key of escaped) {
      const row = results.get(key)!
      console.log(`  ${pad(key, 24)} ${row.released}/${row.seen}   e.g. ${row.examples.join(", ")}`)
    }
    console.log(
      "\nThat is not automatically a bug — it is a statement about where the authority actually lives.\n" +
        "For each of these, arming an auto-approve rule makes the MODEL load-bearing: the only thing\n" +
        "between the invoice and a payment is the model having read the policy correctly. Either a\n" +
        "deterministic check has to catch it, or auto-approve must not be armed for that customer."
    )
  } else {
    console.log("\nNo labelled nasty reaches auto_approve even with the model assumed wrong.")
  }

  /*
   * The gate, as a ratchet in both directions.
   *
   * Failing only on unlisted escapes would let the list grow quietly into a list of everything. So a
   * STALE entry fails too: if a scenario in `KNOWN_UNGATED` is now being stopped, the mechanism landed
   * and the entry has to go, or the next reader believes a hole exists that does not.
   */
  const unexpected = escaped.filter((key) => !KNOWN_UNGATED.has(key))
  const stale = [...KNOWN_UNGATED.keys()].filter((key) => !escaped.includes(key))

  const acknowledged = escaped.filter((key) => KNOWN_UNGATED.has(key))
  if (acknowledged.length > 0) {
    console.log("\nKnown and accepted, each with the mechanism that would close it:\n")
    for (const key of acknowledged) console.log(`  ${key}\n    ${KNOWN_UNGATED.get(key)}\n`)
  }

  if (!STRICT) return

  const problems: Array<string> = []
  if (unexpected.length > 0) {
    problems.push(
      `${unexpected.length} labelled scenario(s) released that are NOT acknowledged: ${unexpected.join(", ")}`
    )
  }
  for (const key of stale) {
    problems.push(
      `KNOWN_UNGATED lists "${key}" but nothing released — the mechanism landed, so delete the entry`
    )
  }

  if (problems.length > 0) {
    console.error("\n✗ GATE FAILED:")
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  console.log(
    `✓ gate passed: every labelled nasty stopped, except ${KNOWN_UNGATED.size} acknowledged above.`
  )
}

main()
