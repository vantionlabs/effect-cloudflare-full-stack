/**
 * Open and close without measuring: a grid row animating from `0fr` to `1fr`. Beautiful UI's drawer pattern.
 *
 * The content stays in the DOM when closed (so a server render and a search both see it) and is hidden from
 * assistive technology with `inert` while closed, so focus cannot land inside something nobody can see.
 */
import { EASE_LINK } from "@/lib/motion"
import type { ReactNode } from "react"

export function Collapsible(props: { readonly open: boolean; readonly id?: string; readonly children: ReactNode }) {
  return (
    <div
      id={props.id}
      className="grid transition-[grid-template-rows,opacity] duration-300"
      style={{
        gridTemplateRows: props.open ? "1fr" : "0fr",
        opacity: props.open ? 1 : 0,
        transitionTimingFunction: EASE_LINK
      }}
      inert={!props.open}
    >
      <div className="min-h-0 overflow-hidden">{props.children}</div>
    </div>
  )
}
