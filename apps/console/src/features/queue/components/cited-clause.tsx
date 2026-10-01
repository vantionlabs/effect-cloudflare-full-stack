/**
 * One citation of a decision, checked against the clause it names: the excerpt highlighted inside the clause text,
 * so a reviewer can see whether it actually occurs there.
 */
import { Highlight } from "./highlight.tsx"

export function CitedClause(props: {
  readonly reference: string
  readonly clauseText: string | null
  readonly excerpt: string
}) {
  return (
    <article className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
      <div className="text-[12px] font-medium text-ink-2">{props.reference}</div>
      {props.clauseText === null
        ? (
          /*
           * The chunk is gone — re-indexed or deleted. Worth saying rather than hiding: a decision whose clause no
           * longer exists cannot be audited the way it was made.
           */
          <p className="text-[13px] text-red">
            the cited clause is no longer in the corpus, so this citation cannot be re-checked
          </p>
        )
        : <Highlight text={props.clauseText} excerpt={props.excerpt} />}
    </article>
  )
}
