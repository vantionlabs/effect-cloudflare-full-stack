/**
 * Chunking, which decides what a citation can be.
 *
 * Worth testing thoroughly and cheaply: a boundary in the wrong place produces a span nobody can
 * verify and a clause reference that points at half a rule, and neither failure is visible downstream
 * — retrieval still returns something, the decision still cites it, and the citation is just wrong.
 */
import { chunkDocument, embeddableText } from "@ea/modules/policy/domain/Chunk"
import { describe, expect, it } from "vitest"

const POLICY = `# Inkoopbeleid 2026

Dit beleid geldt voor alle inkopen.

## Artikel 3 Inkoopverplichtingen

Facturen boven EUR 5.000 vereisen twee goedkeuringen van de inkoopafdeling.

### Artikel 3.2 Uitzonderingen

Spoedopdrachten mogen door één manager worden goedgekeurd.

## 4.1 Betalingstermijn

De betalingstermijn voor leveranciers is dertig dagen.

## Bijlage A

Contactgegevens van de inkoopafdeling.
`

describe("chunkDocument", () => {
  it("splits at headings, so a chunk is a clause", () => {
    const chunks = chunkDocument(POLICY, { title: "Inkoopbeleid" })
    expect(chunks.map((chunk) => chunk.heading)).toEqual([
      "Inkoopbeleid 2026",
      "Artikel 3 Inkoopverplichtingen",
      "Artikel 3.2 Uitzonderingen",
      "4.1 Betalingstermijn",
      "Bijlage A"
    ])
  })

  it("keeps the clause whole rather than windowing across it", () => {
    const [, artikel3] = chunkDocument(POLICY, { title: "Inkoopbeleid" })
    expect(artikel3!.content).toBe(
      "Facturen boven EUR 5.000 vereisen twee goedkeuringen van de inkoopafdeling."
    )
  })

  it("lifts the clause reference from the heading", () => {
    const refs = chunkDocument(POLICY, { title: "Inkoopbeleid" }).map((chunk) => chunk.clauseRef)
    expect(refs).toEqual([null, "Artikel 3", "Artikel 3.2", "4.1", "Bijlage A"])
  })

  it("records ancestor headings, not the chunk's own", () => {
    const nested = chunkDocument(POLICY, { title: "Inkoopbeleid" })[2]!
    expect(nested.heading).toBe("Artikel 3.2 Uitzonderingen")
    expect(nested.headingPath).toEqual(["Inkoopbeleid 2026", "Artikel 3 Inkoopverplichtingen"])
  })

  it("builds a contextual prefix that makes a fragment embeddable", () => {
    // "Spoedopdrachten mogen door één manager worden goedgekeurd" says nothing about purchasing on
    // its own. The prefix is what gives the vector something to be near.
    const nested = chunkDocument(POLICY, { title: "Inkoopbeleid" })[2]!
    expect(nested.contextPrefix).toBe(
      "Inkoopbeleid > Inkoopbeleid 2026 > Artikel 3 Inkoopverplichtingen > Artikel 3.2 Uitzonderingen"
    )
    expect(embeddableText(nested)).toBe(`${nested.contextPrefix}\n\n${nested.content}`)
  })

  it("keeps the prefix OUT of the citable content", () => {
    // Load-bearing. `containsVerbatim` checks a span against the document, and the prefix is ours
    // rather than the document's — a citation quoting it would verify text nobody wrote.
    for (const chunk of chunkDocument(POLICY, { title: "Inkoopbeleid" })) {
      expect(chunk.content).not.toContain("Inkoopbeleid >")
      expect(POLICY).toContain(chunk.content.split("\n")[0]!)
    }
  })

  it("drops a heading that has no body of its own", () => {
    // A container heading would otherwise become an empty chunk: never citable, still retrievable.
    const chunks = chunkDocument("# Title\n\n## Container\n\n### Real\n\nBody text.\n", { title: "T" })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.heading).toBe("Real")
    expect(chunks[0]!.headingPath).toEqual(["Title", "Container"])
  })

  it("splits an oversized section at paragraph boundaries, never mid-sentence", () => {
    const paragraph = `${"Dit is een lange alinea over inkoopbeleid. ".repeat(20)}\n`
    const long = `# Beleid\n\n## Artikel 9\n\n${paragraph}\n${paragraph}\n${paragraph}\n`
    const chunks = chunkDocument(long, { title: "Beleid" })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      // Every part still ends where a sentence ended.
      expect(chunk.content.trimEnd().endsWith(".")).toBe(true)
      // And every part still knows which clause it came from.
      expect(chunk.clauseRef).toBe("Artikel 9")
    }
  })

  it("numbers chunks contiguously, including split parts", () => {
    const paragraph = `${"Tekst. ".repeat(200)}\n`
    const chunks = chunkDocument(`# A\n\n## B\n\n${paragraph}\n${paragraph}\n## C\n\nKort.\n`, { title: "A" })
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index))
  })

  it("does not invent a clause reference from a year or an amount", () => {
    // A wrong clause_ref is worse than none: the obligations index fetches BY it, so a mis-parse
    // retrieves the wrong rule while looking entirely correct.
    const chunks = chunkDocument("# Doc\n\n## 2026 Vooruitblik\n\nTekst.\n\n## EUR 5.000 grens\n\nMeer.\n", {
      title: "Doc"
    })
    expect(chunks.map((chunk) => chunk.clauseRef)).toEqual([null, null])
  })

  it("handles a document with no headings at all", () => {
    const chunks = chunkDocument("Gewoon wat tekst zonder koppen.\n", { title: "Los" })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.heading).toBeNull()
    expect(chunks[0]!.contextPrefix).toBe("Los")
  })
})
