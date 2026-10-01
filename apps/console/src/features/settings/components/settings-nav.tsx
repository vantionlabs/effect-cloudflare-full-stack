/**
 * Jump links for the settings sections, with Beautiful UI's glide highlight (the vendored `GlideMenu`, MIT) and the
 * current section marked while scrolling — the same pairing their site's own section nav uses.
 */
import GlideMenu from "@/components/primitives/GlideMenu"
import { cn } from "@/lib/utils"
import { useEffect, useState } from "react"

const SECTIONS = [
  { id: "team", label: "Team" },
  { id: "organisatie", label: "Organisatie" },
  { id: "offerte-email", label: "Offerte-e-mail" },
  { id: "api-sleutels", label: "API-sleutels" }
] as const

export function SettingsNav() {
  const [current, setCurrent] = useState<string>(SECTIONS[0].id)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setCurrent(entry.target.id)
      },
      { rootMargin: "-20% 0px -70% 0px" }
    )
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id)
      if (element !== null) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <nav aria-label="Instellingen" className="md:sticky md:top-8">
      <GlideMenu
        className="flex flex-row gap-1 md:flex-col"
        highlightClassName="inset-x-0 hidden rounded-control bg-hover md:block"
      >
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            data-menu-row
            aria-current={current === section.id ? "location" : undefined}
            className={cn(
              "relative z-10 rounded-control px-2.5 py-1.5 text-[13px] transition-colors duration-150 focus-visible:outline-none",
              current === section.id
                ? "bg-hover-2 font-medium text-ink group-hover/glide-menu:bg-transparent"
                : "text-ink-2 hover:text-ink"
            )}
            onClick={(event) => {
              event.preventDefault()
              document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
              history.replaceState(null, "", `#${section.id}`)
              setCurrent(section.id)
            }}
          >
            {section.label}
          </a>
        ))}
      </GlideMenu>
    </nav>
  )
}
