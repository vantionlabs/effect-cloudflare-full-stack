/**
 * ⌘K — jump to a page or a record from anywhere in the console.
 *
 * Built on Beautiful UI's SearchList (made keyboard-driven, see its LOCAL CHANGE note). Shared, so it imports no
 * feature: the RECORDS it searches arrive through `useRecords`, a hook the route passes in, and it is called only
 * while the palette is open — opening the console does not fetch every quote and product on every page.
 *
 * A native modal <dialog>: the rest of the page is inert while it is open, so Tab cannot wander behind it, and Esc
 * closes it. Focus goes back to whatever opened it (the sidebar button, or the field the person was in).
 */
import SearchList, { type SearchItem } from "@/components/primitives/SearchList"
import { popIn } from "@/lib/motion"
import { useRouter } from "@tanstack/react-router"
import { useEffect, useRef } from "react"

/** A searchable thing that leads somewhere. `href` may carry a `#hash` to land on a section. */
export type CommandItem = SearchItem & { readonly href: string }

export type CommandRecords = { readonly loading: boolean; readonly items: ReadonlyArray<CommandItem> }

export function CommandPalette(props: {
  readonly pages: ReadonlyArray<CommandItem>
  readonly useRecords: () => CommandRecords
  readonly onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const router = useRouter()

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    return () => {
      if (element.open) element.close()
      opener?.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      aria-label="Zoeken"
      onCancel={(event) => {
        event.preventDefault()
        props.onClose()
      }}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself, outside the card) closes it.
        if (event.target === event.currentTarget) props.onClose()
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-4 pt-[12vh] backdrop:bg-black/30 backdrop:backdrop-blur-[2px] sm:p-6 sm:pt-[14vh]"
    >
      <div className="mx-auto w-full max-w-xl" style={popIn("top center")}>
        <Results
          pages={props.pages}
          useRecords={props.useRecords}
          onSelect={(item) => {
            props.onClose()
            void router.navigate({ href: item.href })
          }}
          onClose={props.onClose}
        />
        <p className="mt-2 hidden text-center text-[11px] text-white/80 sm:block">
          ↑ ↓ om te kiezen · Enter om te openen · Esc om te sluiten
        </p>
      </div>
    </dialog>
  )
}

/** A separate component so the records hook runs only while the palette is mounted. */
function Results(props: {
  readonly pages: ReadonlyArray<CommandItem>
  readonly useRecords: () => CommandRecords
  readonly onSelect: (item: CommandItem) => void
  readonly onClose: () => void
}) {
  const records = props.useRecords()
  const items = [...props.pages, ...records.items]
  const byId = new Map(items.map((item) => [item.id, item]))
  return (
    <SearchList
      items={items}
      loading={records.loading}
      emptyQueryGroups={["Pagina's"]}
      onSelect={(item) => {
        const chosen = byId.get(item.id)
        if (chosen !== undefined) props.onSelect(chosen)
      }}
      onEscape={props.onClose}
    />
  )
}

/** ⌘K on macOS, Ctrl+K elsewhere. Ignored while another dialog is open. */
export const useCommandShortcut = (open: () => void) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        open()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])
}
