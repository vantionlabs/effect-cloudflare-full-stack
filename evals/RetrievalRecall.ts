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
import { EmbeddingProfile } from "@ea/modules/policy/domain/Embedding"
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
/** What the pipeline itself will request. */
const K = 8

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

const layers = Layer.mergeAll(Db.layer, IdsLive, Embedder).pipe(Layer.provideMerge(Pg))

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(
        CurrentUser,
        new Identity({ userId: UserId.make("eval"), orgId: ORG, email: "eval@example.com", role: "reviewer" })
      ),
      Effect.provide(layers)
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

const main = async () => {
  /*
   * Migrate first. The harness is self-contained on purpose: a gate that measures whatever schema
   * happens to be lying around is not a gate. This caught its own version of that — the OR-semantics
   * fix to the retrieval function sat unapplied while the harness cheerfully reported the old number.
   */
  await Effect.runPromise(migrate.pipe(Effect.provide(Pg)) as Effect.Effect<unknown, unknown, never>)

  // Seed the document row the chunks reference, then index the corpus.
  await Effect.runPromise(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql`
        insert into source_documents (id, organization_id, collection, filename, r2_key, content_type)
        values (${DOCUMENT_ID}, ${ORG}, 'policy', 'inkoopbeleid.md', ${`${ORG}/${DOCUMENT_ID}`}, 'text/markdown')
        on conflict (id) do nothing
      `).pipe(Effect.provide(Pg))
  )

  const indexed = await run(
    IndexPolicyDocument({ documentId: DOCUMENT_ID, title: "Inkoopbeleid", text: corpus, collection: "policy" })
  )
  const profile = await Effect.runPromise(
    Effect.flatMap(EmbeddingProfile, (value) => Effect.succeed(value)).pipe(Effect.provide(Embedder))
  )

  console.log(`corpus: ${indexed.chunks} chunks, ${indexed.embedded} embedded`)
  console.log(`embedder: ${profile.modelId} (${profile.dimensions}d, semantic=${profile.semantic})`)
  console.log(`gold set: ${gold.cases.length} queries, gate at k=${GATE_DEPTH}\n`)

  const hybridAt = (depth: number) =>
    score("hybrid (RRF)", depth, async (query, limit) => {
      const result = await run(RetrievePolicy({ query, limit }))
      return result.chunks.map((chunk) => chunk.clause_ref)
    })

  // Lexical-only is measured by asking the SQL function with a null embedding — the same code path
  // production takes when the embedder is unavailable, not a separate query written for the harness.
  const lexicalAt = (depth: number) =>
    score("lexical only", depth, async (query, limit) => {
      const rows = await run(
        Effect.flatMap(Db, (db) =>
          db.scoped((sql) =>
            sql<{ clause_ref: string | null }>`
              select clause_ref from retrieve_policy(${query}, null::vector, 'policy', ${limit})
            `
          ))
      )
      return rows.map((row) => row.clause_ref)
    })

  const results: Array<{ depth: number; lexical: Score; hybrid: Score }> = []
  for (const depth of DEPTHS) {
    results.push({ depth, lexical: await lexicalAt(depth), hybrid: await hybridAt(depth) })
  }

  console.log("k   mode            recall    any-hit   MRR")
  for (const { depth, lexical: lex, hybrid: hyb } of results) {
    for (const result of [lex, hyb]) {
      console.log(
        `${String(depth).padEnd(3)} ${result.label.padEnd(15)} ${percent(result.recall).padStart(7)}  ${
          percent(result.hitRate).padStart(8)
        }  ${result.mrr.toFixed(3)}`
      )
    }
  }

  const gated = results.find((entry) => entry.depth === GATE_DEPTH)!
  const lexical = gated.lexical
  const hybrid = gated.hybrid

  if (!profile.semantic) {
    console.log(
      "\nNOTE: this embedder is not semantic, so the hybrid row is lexical retrieval plus noise.\n" +
        "      The two rows differing at all reflects RRF reordering, NOT semantic recall. Set\n" +
        "      EMBEDDING_API_KEY and swap to EmbedderOpenAiCompatible to measure the real thing."
    )
  }

  const reported = profile.semantic ? hybrid : lexical
  if (reported.misses.length > 0) {
    console.log(`\nmissed (${reported.label}):`)
    for (const miss of reported.misses) console.log(`  - ${miss}`)
  }

  /*
   * The gate.
   *
   * Set on the LEXICAL number, because that is the one this embedder can honestly report, and because
   * lexical recall is the floor the semantic half is supposed to improve on rather than rescue. 0.75
   * is chosen from the gold set's composition: two of twelve cases share almost no vocabulary with
   * their clause ("factuur in dollars" → Artikel 7 Valuta), and those are exactly the cases a real
   * embedder should win. Missing more than that means the chunker or the Dutch configuration is wrong,
   * not that the queries are hard.
   */
  const FLOOR = 0.75
  if (lexical.recall < FLOOR) {
    console.error(
      `\n✗ GATE FAILED: lexical recall@${GATE_DEPTH} is ${percent(lexical.recall)}, below the ${
        percent(FLOOR)
      } floor.\n` +
        "  Fix retrieval before building the decide pipeline on it. A queue full of needs_human will\n" +
        "  not tell you this is why."
    )
    process.exit(1)
  }

  console.log(
    `\n✓ gate passed: lexical recall@${GATE_DEPTH} ${percent(lexical.recall)} >= ${percent(FLOOR)}`
  )
  console.log(
    `  Corpus is ${indexed.chunks} chunks, so recall@${K} is weak evidence — watch the k=${GATE_DEPTH} row.`
  )
  console.log(
    "  Not comparable to docket's 33/99, which is an end-to-end grounded rate. They meet at step 11."
  )
}

await main()
