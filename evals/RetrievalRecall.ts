#!/usr/bin/env bun
/**
 * The retrieval recall gate (build-order step 6).
 *
 * **Why this runs before step 7 rather than after.** A decide pipeline built on retrieval that cannot
 * find the applicable clause produces a review queue full of `needs_human`, and the queue UI will not
 * tell you why — it will just be full. Retrieval failure and honest caution look identical from the
 * outside, so the only way to distinguish them is to measure retrieval on its own, against clauses a
 * human labelled, before anything downstream can hide it.
 *
 * **On docket's 33/99 baseline.** The plan says to measure against it, and that comparison cannot be
 * made here: 33/99 is a *grounded decision rate* from an end-to-end run — retrieval, extraction, the
 * model and four rails compounded. This measures recall@k against gold-labelled clauses, which is one
 * input to that number. The two meet at step 11, when the full pipeline runs on the real corpus. Until
 * then this gate answers a narrower and more useful question: **when the answer is in the corpus, does
 * retrieval return it?** Reporting a recall figure as if it were comparable to 33/99 would be worse
 * than reporting nothing.
 *
 *   bun run evals:retrieval
 */
import { type Chunker, ChunkerHeading } from "@ea/modules/policy/domain/Chunk"
import { EmbeddingProfile } from "@ea/modules/policy/domain/Embedding"
import { chunkerLangChain } from "@ea/modules/policy/server/Chunk"
import { EmbedderDeterministic, EmbedderWorkersAiRest } from "@ea/modules/policy/server/Embedding"
import { IndexPolicyDocument } from "@ea/modules/policy/use-cases/Chunk"
import { RetrievePolicy } from "@ea/modules/policy/use-cases/Retrieval"
import { CurrentOrgFromUser, CurrentUser, Identity, OrgId, UserId } from "@ea/modules/shared/domain/Identity"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db } from "@ea/modules/shared/tables/Database"
import { migrate } from "@ea/modules/shared/tables/Migrations"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { existsSync, readFileSync } from "node:fs"

/**
 * Loads `apps/worker/.env` into the environment.
 *
 * Bun auto-loads a `.env` in the working directory, and this runs from the repo root — so the Worker's
 * own env file, which is where the Hyperdrive string and the Cloudflare credentials already live, is
 * invisible without this. One source of truth for both `wrangler dev` and the harness beats two files
 * that drift.
 *
 * Existing environment variables win, so CI can supply secrets without a file.
 */
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

const ORG = OrgId.make("eval_retrieval")
const DOCUMENT_ID = "eval_retrieval_doc"
/**
 * Retrieval depths reported.
 *
 * `8` is what the decide pipeline will pass. `3` is the number to actually watch, and the reason is
 * arithmetic: this fixture corpus has 12 chunks, so recall@8 returns two-thirds of it and would look
 * respectable even on a badly ranked corpus. recall@3 cannot be reached by accident. When the real
 * corpus lands at step 11 the two converge in usefulness; until then, gate on the strict one.
 */
const DEPTHS = [3, 8] as const
const GATE_DEPTH = 3

interface GoldCase {
  readonly query: string
  readonly expect: ReadonlyArray<string>
  readonly lexicalOverlap: "high" | "partial" | "none"
}

const gold = JSON.parse(
  readFileSync(new URL("./fixtures/retrieval-gold.json", import.meta.url), "utf8")
) as { readonly cases: ReadonlyArray<GoldCase> }

const corpus = readFileSync(new URL("./fixtures/inkoopbeleid.md", import.meta.url), "utf8")

const Pg = PgClient.layer({
  host: process.env["PGHOST"] ?? "localhost",
  port: Number(process.env["PGPORT"] ?? 55433),
  username: process.env["PGUSER"] ?? "effect_ai",
  password: Redacted.make(process.env["PGPASSWORD"] ?? "local_dev_only"),
  database: process.env["PGDATABASE"] ?? "effect_ai",
  ssl: false
})

const IdsLive = Layer.succeed(Ids)({ next: Effect.sync(() => crypto.randomUUID()) })

/**
 * The embedder under test.
 *
 * Swap for `EmbedderOpenAiCompatible` and set `EMBEDDING_API_KEY` to measure the semantic half for
 * real. With the deterministic one the semantic column is noise, and the report says so rather than
 * printing a number that looks like a result.
 */
/**
 * The embedder under test, chosen by whether credentials are present.
 *
 * Falling back is safe ONLY because `EmbeddingProfile.semantic` travels with the choice and the report
 * reads it: with the deterministic embedder the hybrid column is suppressed as meaningless rather than
 * printed as a result. A harness that quietly downgraded and still reported a semantic number would be
 * worse than one that refused to run.
 */
const hasWorkersAi = process.env["CLOUDFLARE_ACCOUNT_ID"] !== undefined &&
  process.env["CLOUDFLARE_AI_TOKEN"] !== undefined

const Embedder = hasWorkersAi ? EmbedderWorkersAiRest : EmbedderDeterministic

/**
 * Read at module scope because `measure` needs it too: it asserts that a `semantic: true` profile
 * actually produced embeddings, and that check belongs next to the ingest it is checking rather
 * than in the reporting code, which runs too late to stop a bad number being printed.
 */
const profile = await Effect.runPromise(
  Effect.flatMap(EmbeddingProfile, (value) => Effect.succeed(value)).pipe(
    Effect.provide(Embedder)
  ) as Effect.Effect<typeof EmbeddingProfile["Service"], unknown, never>
)

/**
 * The strategies under comparison.
 *
 * Only the chunker varies: same corpus, same embedder, same store, same SQL function, same gold set.
 * That is the point — a comparison where two things changed tells you nothing about either.
 */
const STRATEGIES: ReadonlyArray<{ readonly label: string; readonly layer: Layer.Layer<Chunker> }> = [
  { label: "heading (ours)", layer: ChunkerHeading },
  /*
   * A SWEEP, not a single setting.
   *
   * The first run of this comparison used one size (1200) against a 1,800-character corpus, got two
   * chunks and 7.7% recall, and that number said nothing about the strategy. Sweeping shows it at its
   * best, which is the only version of the comparison worth acting on. 150 is roughly the average chunk
   * the heading strategy produces on this corpus, so it is the like-for-like point.
   */
  { label: "langchain 150", layer: chunkerLangChain(150) },
  { label: "langchain 300", layer: chunkerLangChain(300) },
  { label: "langchain 600", layer: chunkerLangChain(600) },
  { label: "langchain 1200", layer: chunkerLangChain(1200) }
]

const run = <A, E>(chunker: Layer.Layer<Chunker>, effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      /*
       * `CurrentOrg` via the bridge rather than provided directly.
       *
       * `Db.scoped` requires the TENANT, not the person, so providing only `CurrentUser` failed with
       * "Service not found: iam/CurrentOrg" — this harness was never updated when the tenancy
       * requirement was inverted, and nothing noticed because nothing ran it. Deriving it from the
       * identity rather than passing ORG twice means the two cannot disagree, which is the reason
       * `CurrentOrgFromUser` exists. It must be provided INSIDE the `CurrentUser` service below,
       * since that is what it reads.
       */
      Effect.provide(CurrentOrgFromUser),
      Effect.provideService(
        CurrentUser,
        new Identity({ userId: UserId.make("eval"), orgId: ORG, email: "eval@example.com", role: "reviewer" })
      ),
      Effect.provide(Layer.mergeAll(Db.layer, IdsLive, Embedder, chunker).pipe(Layer.provideMerge(Pg)))
    ) as Effect.Effect<A, E, never>
  )

interface Score {
  readonly label: string
  readonly recall: number
  readonly hitRate: number
  readonly mrr: number
  readonly misses: ReadonlyArray<string>
}

const score = async (
  label: string,
  depth: number,
  retrieve: (query: string, depth: number) => Promise<ReadonlyArray<string | null>>
): Promise<Score> => {
  let expectedTotal = 0
  let foundTotal = 0
  let casesWithAnyHit = 0
  let reciprocalSum = 0
  const misses: Array<string> = []

  for (const testCase of gold.cases) {
    const refs = await retrieve(testCase.query, depth)
    const found = testCase.expect.filter((ref) => refs.includes(ref))
    expectedTotal += testCase.expect.length
    foundTotal += found.length
    if (found.length > 0) casesWithAnyHit++

    const firstHit = refs.findIndex((ref) => ref !== null && testCase.expect.includes(ref))
    if (firstHit >= 0) reciprocalSum += 1 / (firstHit + 1)

    for (const ref of testCase.expect) {
      if (!refs.includes(ref)) misses.push(`${ref} for "${testCase.query}" (${testCase.lexicalOverlap} overlap)`)
    }
  }

  return {
    label,
    recall: foundTotal / expectedTotal,
    hitRate: casesWithAnyHit / gold.cases.length,
    mrr: reciprocalSum / gold.cases.length,
    misses
  }
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

/** One strategy's numbers at one depth. */
interface Measured {
  readonly strategy: string
  readonly depth: number
  readonly chunks: number
  readonly lexical: Score
  readonly hybrid: Score
  readonly withClauseRef: number
}

const measure = async (
  strategy: { readonly label: string; readonly layer: Layer.Layer<Chunker> }
): Promise<ReadonlyArray<Measured>> => {
  const indexed = await run(
    strategy.layer,
    IndexPolicyDocument({
      documentId: DOCUMENT_ID,
      title: "Inkoopbeleid",
      text: corpus,
      collection: "policy"
    })
  )

  /*
   * Did the semantic half actually happen?
   *
   * This exists because the report lied. Every row printed identical lexical and hybrid recall —
   * 84.6/84.6, 100/100, 69.2/69.2, 38.5/38.5, 7.7/7.7 — which is not a plausible coincidence across
   * five chunkers and two depths. Every embedding in the corpus was NULL: the embed calls were
   * failing, `document_chunks.embedding` is nullable BY DESIGN so a chunk degrades to lexical-only
   * rather than destroying the audit trail, and RRF over an empty semantic CTE quietly reduces to
   * lexical ranking. So the gate was measuring lexical retrieval and calling it "what production
   * delivers".
   *
   * The existing guard only covered the case where credentials are ABSENT and the deterministic
   * embedder is substituted. It could not see the case where the real embedder is selected, claims
   * `semantic: true`, and then fails on every call — which is the one that actually happened, and the
   * more dangerous one, because it reports a number instead of a warning.
   *
   * This is the product's own thesis applied to its harness: a measurement that cannot fail is not a
   * measurement, and degraded retrieval that nobody can see is the failure this codebase exists to
   * refuse. So it throws rather than warns.
   */
  const embedded = await run(
    strategy.layer,
    Effect.flatMap(Db, (db) =>
      db.scoped((sql) =>
        sql<{ total: number; embedded: number }>`
          select count(*)::int as total, count(embedding)::int as embedded
            from document_chunks
           where document_id = ${DOCUMENT_ID}
        `
      ))
  )
  const counts = embedded[0] ?? { total: 0, embedded: 0 }
  if (profile.semantic && counts.embedded < counts.total) {
    throw new Error(
      `${strategy.label}: the embedder reports semantic=true, but only ${counts.embedded} of ` +
        `${counts.total} chunks have an embedding.\n` +
        "RRF over an empty semantic side silently degrades to lexical, so the hybrid column would be " +
        "a lexical number wearing a semantic label. Refusing to report it.\n" +
        "Check that CLOUDFLARE_AI_TOKEN is valid and that the Workers AI account has neurons available."
    )
  }

  /*
   * How many chunks carry a citable reference.
   *
   * Reported alongside recall because it is the thing recall cannot show. The obligations index
   * (slice 1.5) fetches applicable rules BY reference, bypassing ranking — so a strategy with perfect
   * recall and no references still cannot support the claim "every applicable rule was considered".
   */
  const refs = await run(
    strategy.layer,
    Effect.flatMap(Db, (db) =>
      db.scoped((sql) =>
        sql<{ n: number }>`
          select count(*)::int as n from document_chunks
           where document_id = ${DOCUMENT_ID} and clause_ref is not null
        `
      ))
  )

  const lexicalAt = (depth: number) =>
    score("lexical only", depth, async (query, limit) => {
      const rows = await run(
        strategy.layer,
        Effect.flatMap(Db, (db) =>
          db.scoped((sql) =>
            sql<{ clause_ref: string | null }>`
              -- The organization is the FOURTH argument and the limit the fifth. This call omitted the
              -- organization entirely until CI ran it: ADR-0014 moved the tenant from a transaction-local
              -- GUC that current_org() read into an explicit parameter, and this baseline was never
              -- updated with it. Postgres answered "function retrieve_policy(unknown, vector, unknown,
              -- integer) does not exist", which reads like a missing migration rather than a wrong
              -- argument list -- the limit was being offered where the tenant belongs.
              select clause_ref
                from retrieve_policy(${query}, null::vector, 'policy', ${ORG}, ${limit})
            `
          ))
      )
      return rows.map((row) => row.clause_ref)
    })

  const hybridAt = (depth: number) =>
    score("hybrid (RRF)", depth, async (query, limit) => {
      const result = await run(strategy.layer, RetrievePolicy({ query, limit }))
      return result.chunks.map((chunk) => chunk.clause_ref)
    })

  const out: Array<Measured> = []
  for (const depth of DEPTHS) {
    out.push({
      strategy: strategy.label,
      depth,
      chunks: indexed.chunks,
      withClauseRef: refs[0]!.n,
      lexical: await lexicalAt(depth),
      hybrid: await hybridAt(depth)
    })
  }
  return out
}

const main = async () => {
  /*
   * Migrate first. The harness is self-contained on purpose: a gate that measures whatever schema
   * happens to be lying around is not a gate. This caught its own version of that — the OR-semantics
   * fix to the retrieval function sat unapplied while the harness cheerfully reported the old number.
   */
  await Effect.runPromise(migrate.pipe(Effect.provide(Pg)) as Effect.Effect<unknown, unknown, never>)

  await Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql`
        insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
        values (${DOCUMENT_ID}, ${ORG}, 'policy', 'inkoopbeleid.md', ${`${ORG}/${DOCUMENT_ID}`}, 'text/markdown')
        on conflict (id) do nothing
      `).pipe(Effect.provide(Pg))
  )

  console.log(`embedder:  ${profile.modelId} (${profile.dimensions}d, semantic=${profile.semantic})`)
  console.log(`gold set:  ${gold.cases.length} queries · gate at k=${GATE_DEPTH}`)
  console.log(`corpus:    evals/fixtures/inkoopbeleid.md`)
  if (!hasWorkersAi) {
    console.log(
      "\nno CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_AI_TOKEN in the environment, so the semantic half is\n" +
        "NOT being measured. Put both in apps/worker/.env to fill in the hybrid column."
    )
  }
  console.log("")

  const all: Array<Measured> = []
  for (const strategy of STRATEGIES) {
    all.push(...await measure(strategy))
  }

  console.log("strategy              chunks  refs  k   lexical  hybrid   MRR(lex)")
  for (const row of all) {
    console.log(
      `${row.strategy.padEnd(21)} ${String(row.chunks).padStart(6)}  ${String(row.withClauseRef).padStart(4)}  ` +
        `${String(row.depth).padEnd(3)} ${percent(row.lexical.recall).padStart(7)}  ` +
        `${percent(row.hybrid.recall).padStart(7)}  ${row.lexical.mrr.toFixed(3)}`
    )
  }

  if (!profile.semantic) {
    console.log(
      "\nNOTE: this embedder is not semantic, so the hybrid column is lexical plus noise. It is shown\n" +
        "      only to confirm RRF reorders; it is NOT evidence about semantic recall. Set a real\n" +
        "      embedder to fill that column in."
    )
  }

  /*
   * Report misses from the column that is actually in force.
   *
   * With a semantic embedder, hybrid is what production runs, so listing lexical misses would name
   * queries the system does not in fact miss. Without one, lexical is all there is.
   */
  for (const row of all.filter((entry) => entry.depth === GATE_DEPTH)) {
    const meaningful = profile.semantic ? row.hybrid : row.lexical
    if (meaningful.misses.length > 0) {
      console.log(`\nmissed by ${row.strategy} at k=${GATE_DEPTH} (${meaningful.label}):`)
      for (const miss of meaningful.misses) console.log(`  - ${miss}`)
    }
  }

  /*
   * The gate applies to the strategy in production, not to the best of the bunch.
   *
   * A comparison that lowered the bar to whatever won would stop being a gate. The floor is set on
   * lexical recall because that is the number this embedder can honestly report.
   */
  /*
   * TWO floors, because they guard different failures.
   *
   * `LEXICAL_FLOOR` is the degraded-mode guarantee: what retrieval still finds when the embedder is
   * unavailable, which is a real operating state — `retrieval_mode` becomes "lexical" and rail 4 stops
   * auto-approving, but decisions continue. `HYBRID_FLOOR` is what production actually delivers, and it
   * is only enforced when the embedder is real; with the deterministic one the hybrid column is noise
   * and gating on it would be gating on nothing.
   */
  const LEXICAL_FLOOR = 0.75
  const HYBRID_FLOOR = 0.9
  const production = all.find((row) => row.depth === GATE_DEPTH && row.strategy === STRATEGIES[0]!.label)!

  const failures: Array<string> = []
  if (production.lexical.recall < LEXICAL_FLOOR) {
    failures.push(
      `lexical recall@${GATE_DEPTH} is ${percent(production.lexical.recall)}, below ` +
        `${percent(LEXICAL_FLOOR)} — retrieval degrades badly when the embedder is down`
    )
  }
  if (profile.semantic && production.hybrid.recall < HYBRID_FLOOR) {
    failures.push(
      `hybrid recall@${GATE_DEPTH} is ${percent(production.hybrid.recall)}, below ` +
        `${percent(HYBRID_FLOOR)} — this is what production delivers`
    )
  }

  if (failures.length > 0) {
    console.error(`\n✗ GATE FAILED for ${production.strategy}:`)
    for (const failure of failures) console.error(`  - ${failure}`)
    console.error(
      "\n  Fix retrieval before building the decide pipeline on it. A queue full of needs_human will\n" +
        "  not tell you this is why."
    )
    process.exit(1)
  }

  console.log(
    `\n✓ gate passed: ${production.strategy} at k=${GATE_DEPTH} — lexical ` +
      `${percent(production.lexical.recall)} >= ${percent(LEXICAL_FLOOR)}` +
      (profile.semantic
        ? `, hybrid ${percent(production.hybrid.recall)} >= ${percent(HYBRID_FLOOR)}`
        : " (hybrid not measured: no semantic embedder)")
  )
  console.log(
    "  Not comparable to docket's 33/99, which is an end-to-end grounded rate. They meet at step 11."
  )
}

await main()
