/**
 * One citation of a decision, checked against the clause it names: the excerpt highlighted inside the clause text,
 * so a reviewer can see whether it actually occurs there. Folds closed once checked (see `Disclosure`).
 */
import { Disclosure } from "./disclosure.tsx"
import { Highlight } from "./highlight.tsx"

export function CitedClause(props: {
  readonly reference: string
  readonly clauseText: string | null
  readonly excerpt: string
}) {
  return (
    <Disclosure
      title={props.reference}
      className="rounded-card bg-surface p-4 shadow-card"
      titleClassName="text-[12px] font-medium text-ink-2"
    >
      <div className="pt-2">
        {props.clauseText === null
          ? (
            /*
             * The chunk is gone — re-indexed or deleted. Worth saying rather than hiding: a decision whose clause no
             * longer exists cannot be audited the way it was made.
             */
            <p className="text-[13px] text-red">
              Deze passage staat niet meer in de documentatie, dus deze bron kan niet opnieuw worden gecontroleerd.
            </p>
          )
          : <Highlight text={props.clauseText} excerpt={props.excerpt} />}
      </div>
    </Disclosure>
  )
}
