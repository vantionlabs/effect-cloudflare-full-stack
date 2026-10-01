/**
 * A titled block that folds open and closed, animated with Beautiful UI's grid-row drawer (`Collapsible`). Starts
 * OPEN: in the inspector, what it holds is the reason a decision is on the screen.
 */
import { Collapsible } from "@/components/motion/collapsible"
import { ChevronDown } from "lucide-react"
import { type ReactNode, useId, useState } from "react"

export function Disclosure(props: {
  readonly title: string
  readonly count?: number
  readonly className?: string
  readonly titleClassName?: string
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  const id = useId()
  return (
    <div className={props.className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={props.titleClassName}>
          {props.title}
          {props.count === undefined ? null : ` (${props.count})`}
        </span>
        <ChevronDown
          className="size-4 shrink-0 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          aria-hidden
        />
      </button>
      <Collapsible open={open} id={id}>{props.children}</Collapsible>
    </div>
  )
}
