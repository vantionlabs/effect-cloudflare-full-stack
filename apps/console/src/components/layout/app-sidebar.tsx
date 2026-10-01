/**
 * The signed-in navigation, in Beautiful UI's visual language.
 *
 * Not the registry's `SidebarNav`: that component hardcodes a demo workspace, its own nav items and a chat history,
 * and imports a commercially licensed icon set. This is the same look — surface, hairlines, ink ramp, pill hover —
 * with our destinations and lucide icons.
 */
import { cn } from "@/lib/utils"
import { Link } from "@tanstack/react-router"
import {
  BarChart3,
  BookOpenText,
  CalendarClock,
  Gauge,
  Inbox,
  LineChart,
  type LucideIcon,
  MessagesSquare,
  ReceiptText
} from "lucide-react"
import type { ReactNode } from "react"

interface NavItem {
  readonly to: "/" | "/chat" | "/ask" | "/sales" | "/planning" | "/insights" | "/usage"
  readonly label: string
  readonly icon: LucideIcon
}

const SECTIONS: ReadonlyArray<{ readonly title: string; readonly items: ReadonlyArray<NavItem> }> = [
  {
    title: "Work",
    items: [
      { to: "/", label: "Queue", icon: Inbox },
      { to: "/sales", label: "Sales", icon: ReceiptText },
      { to: "/planning", label: "Planning", icon: CalendarClock }
    ]
  },
  {
    title: "Ask",
    items: [
      { to: "/ask", label: "Ask the docs", icon: BookOpenText },
      { to: "/insights", label: "Insights", icon: LineChart },
      { to: "/chat", label: "Chat", icon: MessagesSquare }
    ]
  },
  { title: "Account", items: [{ to: "/usage", label: "Usage", icon: Gauge }] }
]

export function AppSidebar(props: { readonly footer: ReactNode }) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 border-line bg-surface p-3 md:sticky md:top-0 md:h-dvh md:w-56 md:border-r">
      <div className="flex items-center gap-2 px-2 pt-1">
        <span className="flex size-6 items-center justify-center rounded-control bg-ink text-canvas">
          <BarChart3 className="size-3.5" aria-hidden />
        </span>
        <span className="text-[13px] font-semibold text-ink">effect-ai</span>
      </div>
      <nav aria-label="Main" className="flex flex-row gap-4 overflow-x-auto md:flex-1 md:flex-col md:overflow-visible">
        {SECTIONS.map((section) => (
          <div key={section.title} className="flex shrink-0 flex-row gap-0.5 md:flex-col">
            <span className="hidden px-2 pb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase md:block">
              {section.title}
            </span>
            {section.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                className={cn(
                  "flex items-center gap-2 rounded-control px-2 py-1.5 text-[13px] text-ink-2 transition-colors",
                  "hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                )}
                activeProps={{ className: "bg-hover-2 text-ink font-medium", "aria-current": "page" }}
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-line pt-3">{props.footer}</div>
    </aside>
  )
}
