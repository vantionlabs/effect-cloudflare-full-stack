/**
 * A figure that ROLLS when it changes — Beautiful UI's odometer, from ApprovalCard (MIT, © 2026 Shane Levine).
 *
 * Only between two real values: the first render shows the value as it is, so nothing counts up from zero to a
 * number that was already known. Use it where a figure changes because the data did — a realtime event, an added
 * expense, a refetch. Screen readers get the whole value from `aria-label`, not the split characters.
 */
import { useEffect, useRef, useState } from "react"

const ROLL_MS = 400

export function RollingDigits(props: { readonly value: string }) {
  const previous = useRef(props.value)
  const [from, setFrom] = useState(props.value)
  const [to, setTo] = useState(props.value)
  const [rolling, setRolling] = useState(false)
  const [shifted, setShifted] = useState(false)
  const [direction, setDirection] = useState<"up" | "down">("up")

  useEffect(() => {
    if (previous.current === props.value) return
    const old = previous.current
    previous.current = props.value
    const a = Number.parseFloat(old.replace(/[^\d,-]/g, "").replace(",", "."))
    const b = Number.parseFloat(props.value.replace(/[^\d,-]/g, "").replace(",", "."))
    setDirection(Number.isFinite(a) && Number.isFinite(b) && b < a ? "down" : "up")
    setFrom(old)
    setTo(props.value)
    setRolling(true)
    setShifted(false)
    let second = 0
    // Two frames: commit the start position before moving, or the browser skips the transition.
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShifted(true))
    })
    const done = setTimeout(() => {
      setRolling(false)
      setFrom(props.value)
      setShifted(false)
    }, ROLL_MS)
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
      clearTimeout(done)
    }
  }, [props.value])

  const chars = rolling ? to : from
  return (
    <span aria-label={props.value} className="tabular">
      <span aria-hidden>
        {Array.from({ length: chars.length }, (_, index) => {
          const o = from[index] ?? ""
          const n = chars[index] ?? ""
          if (!rolling || o === n) return <span key={`${index}-${n}`}>{n}</span>
          const [top, bottom] = direction === "down" ? [n, o] : [o, n]
          const rest = direction === "down" ? "0" : "-1em"
          const start = direction === "down" ? "-1em" : "0"
          return (
            <span
              key={`${index}-${o}-${n}-${direction}`}
              style={{
                display: "inline-block",
                position: "relative",
                overflow: "hidden",
                height: "1em",
                lineHeight: "1em",
                verticalAlign: "-0.05em"
              }}
            >
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  transition: "transform 350ms cubic-bezier(0.4, 0, 0.2, 1)",
                  transform: `translateY(${shifted ? rest : start})`
                }}
              >
                <span style={{ height: "1em" }}>{top}</span>
                <span style={{ height: "1em" }}>{bottom}</span>
              </span>
            </span>
          )
        })}
      </span>
    </span>
  )
}
