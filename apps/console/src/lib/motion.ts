/**
 * The console's motion vocabulary, taken from Beautiful UI's site and registry (MIT, © 2026 Shane Levine — see
 * components/BEAUTIFUL-UI-LICENSE). No animation library: CSS keyframes from foundation.css, two curves, and a short
 * duration ladder. Motion here conveys state — something arrived, something is stale, something opened — and never
 * decorates a page that is just sitting there.
 *
 * Everything starts from a VISIBLE default where the server rendered it: `enter` uses `animation-fill-mode: both`
 * from CSS on first paint, which needs no JavaScript, so SSR content is never hidden waiting for hydration.
 * `prefers-reduced-motion` is handled globally in foundation.css.
 */
import type { CSSProperties } from "react"

/** The workhorse: entrances, glides, pops, toggles. */
export const EASE_OUT_STRONG = "cubic-bezier(0.23, 1, 0.32, 1)"
/** Expo-out: reveals, drawers, the sidebar. */
export const EASE_LINK = "cubic-bezier(0.16, 1, 0.3, 1)"

/**
 * A row or card arriving: `fade-up`, staggered, with the stagger CAPPED so the sixth row onwards arrives with the
 * fifth — a long list never takes seconds to finish entering.
 */
export const enter = (
  index = 0,
  options: { readonly ms?: number; readonly step?: number; readonly cap?: number } = {}
): CSSProperties => {
  const { ms = 400, step = 60, cap = 4 } = options
  return { animation: `fade-up ${ms}ms ${EASE_OUT_STRONG} ${step * Math.min(index, cap)}ms both` }
}

/** A popover or menu growing out of the control that opened it. */
export const popIn = (origin = "top left"): CSSProperties => ({
  animation: `pop-in 180ms ${EASE_OUT_STRONG} both`,
  transformOrigin: origin
})

/**
 * Content that is being replaced — the previous answer while a new question runs. It IS stale, so dimming it is
 * honest; it stays readable and in place rather than disappearing into a spinner.
 */
export const superseded = (resolving: boolean): CSSProperties => ({
  opacity: resolving ? 0.55 : 1,
  filter: resolving ? "blur(0.5px)" : "blur(0)",
  transform: resolving ? "scale(0.985)" : "scale(1)",
  transformOrigin: "top left",
  transition: `opacity 400ms ${EASE_OUT_STRONG}, filter 400ms ${EASE_OUT_STRONG}, transform 400ms ${EASE_OUT_STRONG}`
})
