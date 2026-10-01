/**
 * Which items ARRIVED after the first render, and each one's stagger slot — so a list can animate what is new
 * (`enter(slot)`) without animating what the page was rendered with.
 *
 * Recorded in refs during render, but idempotently: an item keeps the slot it was first given, so React rendering
 * twice (StrictMode, a concurrent retry) computes the same answer both times. The returned map keeps the slot for
 * good, which is harmless — a CSS animation plays when it is first applied, not on every render.
 */
import { useRef } from "react"

export const useArrivals = <A>(items: ReadonlyArray<A>, idOf: (item: A) => string): ReadonlyMap<string, number> => {
  const initial = useRef<ReadonlySet<string> | null>(null)
  const slots = useRef(new Map<string, number>())
  if (initial.current === null) initial.current = new Set(items.map(idOf))
  let batch = 0
  for (const item of items) {
    const id = idOf(item)
    if (initial.current.has(id) || slots.current.has(id)) continue
    slots.current.set(id, batch++)
  }
  return slots.current
}
