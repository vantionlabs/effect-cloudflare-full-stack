/**
 * The engine's vocabulary in the reviewer's words. The wire values (`needs_human`, `lexical`) stay the contract; this
 * is only what a person reads.
 */
const OUTCOMES: Readonly<Record<string, string>> = {
  auto_approve: "Automatisch goedgekeurd",
  route_for_approval: "Ter goedkeuring",
  reject: "Voorstel: afwijzen",
  needs_human: "Beoordeling nodig"
}

const RETRIEVAL: Readonly<Record<string, string>> = {
  hybrid: "volledig gezocht",
  lexical: "alleen op woorden gezocht",
  semantic: "alleen op betekenis gezocht"
}

export const outcomeLabel = (outcome: string): string => OUTCOMES[outcome] ?? outcome
export const retrievalLabel = (mode: string): string => RETRIEVAL[mode] ?? mode
