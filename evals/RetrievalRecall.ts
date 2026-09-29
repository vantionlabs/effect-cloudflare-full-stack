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
import { EmbedderDeterministic } from "@ea/modules/policy/server/Embedding"
import { IndexPolicyDocument } from "@ea/modules/policy/use-cases/Chunk"
import { RetrievePolicy } from "@ea/modules/policy/use-cases/Retrieval"
import { CurrentUser, Identity, OrgId, UserId } from "@ea/modules/shared/domain/Identity"
import { Ids } from "@ea/modules/shared/domain/Ids"
import { Db, migrate } from "@ea/modules/shared/tables/Database"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { SqlClient } from "effect/sql"
import { readFileSync } from "node:fs"

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
const Embedder = EmbedderDeterministic

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
              select clause_ref from retrieve_policy(${query}, null::vector, 'policy', ${limit})
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

  const profile = await Effect.runPromise(
    Effect.flatMap(EmbeddingProfile, (value) => Effect.succeed(value)).pipe(Effect.provide(Embedder))
  )

  console.log(`embedder:  ${profile.modelId} (${profile.dimensions}d, semantic=${profile.semantic})`)
  console.log(`gold set:  ${gold.cases.length} queries · gate at k=${GATE_DEPTH}`)
  console.log(`corpus:    evals/fixtures/inkoopbeleid.md\n`)

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

  for (const row of all.filter((entry) => entry.depth === GATE_DEPTH)) {
    if (row.lexical.misses.length > 0) {
      console.log(`\nmissed by ${row.strategy} at k=${GATE_DEPTH}:`)
      for (const miss of row.lexical.misses) console.log(`  - ${miss}`)
    }
  }

  /*
   * The gate applies to the strategy in production, not to the best of the bunch.
   *
   * A comparison that lowered the bar to whatever won would stop being a gate. The floor is set on
   * lexical recall because that is the number this embedder can honestly report.
   */
  const FLOOR = 0.75
  const production = all.find((row) => row.depth === GATE_DEPTH && row.strategy === STRATEGIES[0]!.label)!

  if (production.lexical.recall < FLOOR) {
    console.error(
      `\n✗ GATE FAILED: ${production.strategy} lexical recall@${GATE_DEPTH} is ` +
        `${percent(production.lexical.recall)}, below the ${percent(FLOOR)} floor.\n` +
        "  Fix retrieval before building the decide pipeline on it. A queue full of needs_human will\n" +
        "  not tell you this is why."
    )
    process.exit(1)
  }

  console.log(
    `\n✓ gate passed: ${production.strategy} lexical recall@${GATE_DEPTH} ` +
      `${percent(production.lexical.recall)} >= ${percent(FLOOR)}`
  )
  console.log(
    "  Not comparable to docket's 33/99, which is an end-to-end grounded rate. They meet at step 11."
  )
}

await main()
