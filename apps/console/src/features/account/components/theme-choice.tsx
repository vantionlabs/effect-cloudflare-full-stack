/**
 * Light, dark or the operating system's choice — a segmented control with a sliding thumb (Beautiful UI's theme
 * toggle, MIT). The stored choice is read AFTER hydration: the server cannot know it, so it renders "Systeem" and the
 * control settles a frame later, while the page itself was already painted in the right theme by the head script
 * (`lib/theme.ts`).
 */
import { useHydrated } from "@/hooks/use-hydrated"
import { EASE_OUT_STRONG } from "@/lib/motion"
import { readTheme, setTheme, type Theme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Monitor, Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"

const OPTIONS: ReadonlyArray<{ readonly value: Theme; readonly label: string; readonly icon: typeof Sun }> = [
  { value: "light", label: "Licht", icon: Sun },
  { value: "dark", label: "Donker", icon: Moon },
  { value: "system", label: "Systeem", icon: Monitor }
]

export function ThemeChoice() {
  const hydrated = useHydrated()
  const [theme, setChoice] = useState<Theme>("system")
  useEffect(() => setChoice(readTheme()), [])
  const index = OPTIONS.findIndex((option) => option.value === theme)

  return (
    <div
      role="radiogroup"
      aria-label="Weergave"
      className="relative grid w-fit grid-cols-3 rounded-full bg-hover-2 p-1"
    >
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-1 rounded-full bg-surface shadow-btn"
        style={{
          width: "calc((100% - 0.5rem) / 3)",
          transform: `translateX(${index * 100}%)`,
          transition: `transform 200ms ${EASE_OUT_STRONG}`
        }}
      />
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          disabled={!hydrated}
          onClick={() => {
            setChoice(option.value)
            setTheme(option.value)
          }}
          className={cn(
            "relative z-10 flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] transition-colors duration-150",
            theme === option.value ? "font-medium text-ink" : "text-ink-2 hover:text-ink"
          )}
        >
          <option.icon className="size-3.5" aria-hidden />
          {option.label}
        </button>
      ))}
    </div>
  )
}
