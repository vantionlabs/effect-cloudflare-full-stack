"use client"

import { useEffect, useRef, useState } from "react"

/* ─────────────────────────────────────────────────────────
 * STREAM TEXT — reusable streaming primitive
 * Reveals characters quickly (fast, like a real token stream);
 * the leading edge resolves out of a soft blur, and the caret
 * stays solid while streaming, then blinks once the text
 * settles. Inherits typography from its context, so it drops
 * into any text surface (Selection Actions, chat, etc.).
 * ───────────────────────────────────────────────────────── */

export function StreamText({
  text,
  charsPerTick = 2,
  tickMs = 9,
  blurTail = 6,
  caret = true,
  className,
  onProgress,
  onDone
}: {
  text: string
  /** characters revealed per tick — higher is faster */
  charsPerTick?: number | undefined
  /** interval between reveals, ms */
  tickMs?: number | undefined
  /** how many trailing characters carry the soft blur edge */
  blurTail?: number | undefined
  /** render the caret (solid while streaming, blinks once idle) */
  caret?: boolean | undefined
  className?: string | undefined
  /** fires each tick — useful for re-anchoring UI to reflowing text */
  onProgress?: (() => void) | undefined
  /** fires once the full string is shown */
  onDone?: (() => void) | undefined
}) {
  const [count, setCount] = useState(0)
  const countRef = useRef(0)
  const previousText = useRef("")
  const onProgressRef = useRef(onProgress)
  const onDoneRef = useRef(onDone)
  onProgressRef.current = onProgress
  onDoneRef.current = onDone

  useEffect(() => {
    /*
     * LOCAL CHANGE (effect-ai): the registry restarted from zero whenever `text` changed, so a real token stream —
     * fed the accumulated text on every chunk — re-typed the whole reply each time. Text that EXTENDS what was shown
     * continues from where it is; only genuinely new text starts over.
     */
    const continues = text.startsWith(previousText.current)
    previousText.current = text
    let i = continues ? countRef.current : 0
    if (!continues) {
      countRef.current = 0
      setCount(0)
    }
    const id = setInterval(() => {
      i = Math.min(i + charsPerTick, text.length)
      countRef.current = i
      setCount(i)
      onProgressRef.current?.()
      if (i >= text.length) {
        clearInterval(id)
        onDoneRef.current?.()
      }
    }, tickMs)
    return () => clearInterval(id)
  }, [text, charsPerTick, tickMs])

  const streaming = count < text.length
  const shown = text.slice(0, count)
  const split = streaming ? Math.max(0, shown.length - blurTail) : shown.length

  return (
    <span className={className}>
      {shown.slice(0, split)}
      {split < shown.length && <span className="stream-tail">{shown.slice(split)}</span>}
      {caret && (
        <span
          aria-hidden
          className={`stream-caret${streaming ? " is-streaming" : ""}`}
        />
      )}
    </span>
  )
}
