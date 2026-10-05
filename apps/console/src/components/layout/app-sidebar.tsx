/**
 * The signed-in navigation, in Beautiful UI's visual language and motion (MIT, see components/BEAUTIFUL-UI-LICENSE).
 *
 * Not the registry's `SidebarNav`: that component hardcodes a demo workspace and its own items, and imports a paid
 * icon set whose install script fails without a licence key. Taken from it instead:
 *
 * - **The glide highlight.** One layer slides between rows on hover and focus, and RESTS on the current page when the
 *   pointer leaves — the registry's GlideMenu idea, driven by the router's active match instead of a scroll spy.
 * - **The collapse.** The tree is always laid out at full width and the <aside> clips it, so icons stay put and
 *   nothing reflows while the width animates (`SIDEBAR_MOTION`). The choice is remembered in this browser, read after
 *   hydration so the server always renders the expanded sidebar.
 */
import { useHydrated } from "@/hooks/use-hydrated"
import { EASE_LINK } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  BarChart3,
  BookOpenText,
  CalendarClock,
  Gauge,
  Inbox,
  LineChart,
  type LucideIcon,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  Search,
  Settings
} from "lucide-react"
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"

const SIDEBAR_MOTION = { expanded: 224, collapsed: 56, duration: 280 } as const
const COLLAPSE_KEY = "effect-ai-sidebar-collapsed"

type Destination = "/" | "/chat" | "/ask" | "/sales" | "/planning" | "/insights" | "/usage" | "/settings"

interface NavItem {
  readonly to: Destination
  readonly label: string
  readonly icon: LucideIcon
}

const SECTIONS: ReadonlyArray<{ readonly title: string; readonly items: ReadonlyArray<NavItem> }> = [
  {
    title: "Werk",
    items: [
      { to: "/", label: "Beoordelen", icon: Inbox },
      { to: "/sales", label: "Verkoop", icon: ReceiptText },
      { to: "/planning", label: "Planning", icon: CalendarClock }
    ]
  },
  {
    title: "Vragen",
    items: [
      { to: "/ask", label: "Documentatie", icon: BookOpenText },
      { to: "/insights", label: "Inzichten", icon: LineChart },
      { to: "/chat", label: "Chat", icon: MessagesSquare }
    ]
  },
  {
    title: "Organisatie",
    items: [
      { to: "/usage", label: "Verbruik", icon: Gauge },
      { to: "/settings", label: "Instellingen", icon: Settings }
    ]
  }
]

/** Every destination as a flat list, for the ⌘K palette's "Pagina's" group. */
export const NAV_ITEMS: ReadonlyArray<NavItem> = SECTIONS.flatMap((section) => section.items)

const isActive = (to: Destination, pathname: string) => to === "/" ? pathname === "/" : pathname.startsWith(to)

export function AppSidebar(
  props: { readonly footer: (collapsed: boolean) => ReactNode; readonly onSearch: () => void }
) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const hydrated = useHydrated()
  const [collapsed, setCollapsed] = useState(false)
  const [hovered, setHovered] = useState<Destination | null>(null)
  const [box, setBox] = useState<{ readonly top: number; readonly height: number } | null>(null)
  const nav = useRef<HTMLElement>(null)
  const rows = useRef(new Map<Destination, HTMLAnchorElement>())

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1")
    } catch {
      // Storage unavailable: expanded, as the server rendered it.
    }
  }, [])

  const active = SECTIONS.flatMap((section) => section.items).find((item) => isActive(item.to, pathname))?.to ?? null
  const target = hovered ?? active

  useLayoutEffect(() => {
    const row = target === null ? undefined : rows.current.get(target)
    const container = nav.current
    if (row === undefined || container === null) return setBox(null)
    const containerRect = container.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    setBox({ top: rowRect.top - containerRect.top + container.scrollTop, height: rowRect.height })
  }, [target, collapsed])

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0")
    } catch {
      // Storage unavailable: the choice holds for this page view.
    }
  }

  return (
    <aside
      data-collapsed={collapsed}
      /*
       * The width is a variable applied only from `md` up: an inline `width` beat every responsive class, which left
       * the phone layout ~280px wide with a white strip beside it.
       */
      className="flex w-full shrink-0 flex-col overflow-hidden border-b border-line bg-surface md:sticky md:top-0 md:h-dvh md:w-(--sidebar-width) md:border-r md:border-b-0"
      style={{
        "--sidebar-width": `${collapsed ? SIDEBAR_MOTION.collapsed : SIDEBAR_MOTION.expanded}px`,
        transition: `width ${SIDEBAR_MOTION.duration}ms ${EASE_LINK}`
      } as CSSProperties}
    >
      <div className="flex w-full flex-col gap-4 p-3 md:h-full md:w-[224px]">
        <div className="flex items-center justify-between gap-2 px-1.5 pt-1">
          <Link to="/" className="flex items-center gap-2 rounded-control focus-visible:outline-none">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-control bg-ink text-canvas">
              <BarChart3 className="size-4" aria-hidden />
            </span>
            <span
              className={cn(
                "text-[14px] font-semibold text-ink transition-opacity duration-150",
                collapsed && "md:opacity-0"
              )}
            >
              effect-ai
            </span>
          </Link>
        </div>

        <button
          type="button"
          onClick={props.onSearch}
          // Until hydration a click would do nothing at all — the trap AGENTS.md names; disabled says so honestly.
          disabled={!hydrated}
          aria-keyshortcuts="Meta+K Control+K"
          title="Zoeken (⌘K)"
          className={cn(
            "flex items-center gap-2 rounded-control bg-inset px-2 py-1.5 text-[13px] text-ink-3 shadow-hairline",
            "transition-colors duration-100 hover:bg-hover hover:text-ink active:scale-[0.98] disabled:opacity-60"
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className={cn("flex-1 text-left transition-opacity duration-150", collapsed && "md:opacity-0")}>
            Zoeken
          </span>
          <kbd
            className={cn(
              "hidden rounded-[4px] bg-surface px-1 font-sans text-[11px] text-ink-3 shadow-hairline transition-opacity duration-150 md:inline",
              collapsed && "md:opacity-0"
            )}
          >
            ⌘K
          </kbd>
        </button>

        <nav
          ref={nav}
          aria-label="Hoofdmenu"
          onMouseLeave={() => setHovered(null)}
          /*
           * On phones the nav is one scrolling row; the mask fades its right edge so it reads as "there is more", rather
           * than a label cut off mid-word.
           */
          className="relative flex flex-row gap-4 overflow-x-auto [mask-image:linear-gradient(90deg,#000_85%,transparent)] md:flex-1 md:flex-col md:overflow-visible md:[mask-image:none]"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 hidden rounded-control bg-hover-2 md:block"
            style={{
              top: box?.top ?? 0,
              height: box?.height ?? 0,
              width: collapsed ? 32 : 200,
              opacity: box === null ? 0 : 1,
              transition:
                `top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), width ${SIDEBAR_MOTION.duration}ms ${EASE_LINK}, opacity 150ms ease`
            }}
          />
          {SECTIONS.map((section) => (
            <div key={section.title} className="flex shrink-0 flex-row gap-0.5 md:flex-col">
              <span
                className={cn(
                  "hidden px-2 pb-1 text-[11px] font-medium text-ink-3 transition-opacity duration-150 md:block",
                  collapsed && "md:opacity-0"
                )}
              >
                {section.title}
              </span>
              {section.items.map((item) => {
                const current = item.to === active
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    ref={(element) => {
                      if (element === null) rows.current.delete(item.to)
                      else rows.current.set(item.to, element)
                    }}
                    title={collapsed ? item.label : undefined}
                    aria-current={current ? "page" : undefined}
                    onMouseEnter={() => setHovered(item.to)}
                    onFocus={() => setHovered(item.to)}
                    onBlur={() => setHovered(null)}
                    className={cn(
                      "relative z-10 flex items-center gap-2.5 rounded-control px-2 py-1.5 text-[13px] whitespace-nowrap",
                      "transition-[color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none",
                      current ? "font-medium text-ink max-md:bg-hover-2" : "text-ink-2 hover:text-ink"
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    <span className={cn("transition-opacity duration-150", collapsed && "md:opacity-0")}>
                      {item.label}
                    </span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {props.footer(collapsed)}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Menu uitklappen" : "Menu inklappen"}
            className="hidden w-fit items-center gap-2 rounded-control px-2 py-1.5 text-[12px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink md:flex"
          >
            {collapsed
              ? <PanelLeftOpen className="size-4" aria-hidden />
              : <PanelLeftClose className="size-4" aria-hidden />}
            <span className={cn("transition-opacity duration-150", collapsed && "opacity-0")}>Inklappen</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
