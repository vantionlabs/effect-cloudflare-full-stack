/** A box to create a channel, with the server's refusal shown in words. */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import { Input } from "@/components/ui/input"
import { useHydrated } from "@/hooks/use-hydrated"
import { describeFailure } from "@/lib/failure"
import { useAtomRefresh, useAtomSet } from "@effect/atom-react"
import { Exit } from "effect"
import { useCallback, useState } from "react"
import { createRoomAtom, roomsAtom } from "../api/room-atoms.ts"

export function NewChannelForm(props: { readonly onCreated: (roomId: string) => void }) {
  const create = useAtomSet(createRoomAtom, { mode: "promiseExit" })
  const refreshRooms = useAtomRefresh(roomsAtom)
  const [name, setName] = useState("")
  /*
   * Gated until hydration (AGENTS.md, "Anything a browser can do before hydration, it will"): a name typed into the
   * server-rendered input is wiped when React hydrates the controlled value, leaving Create disabled with an empty
   * box. The e2e suite types faster than the bundle loads and found exactly that.
   */
  const hydrated = useHydrated()
  const [rejected, setRejected] = useState<string | undefined>(undefined)

  const submit = useCallback(async () => {
    const trimmed = name.trim()
    if (trimmed === "") return
    setRejected(undefined)
    const exit = await create({ payload: { name: trimmed } })
    if (Exit.isFailure(exit)) {
      /*
       * Both refusals are actionable and read differently — "that channel exists" versus "pick a real name". By
       * `_tag` (inside `describeFailure`), never `.message`: a `Schema.TaggedError`'s message is usually empty.
       */
      setRejected(describeFailure(exit, {
        RoomSlugTaken: "A channel with that name already exists.",
        RoomNameInvalid: "A channel name needs letters or numbers."
      }))
      return
    }
    setName("")
    /*
     * The list is refreshed locally as well as by the broadcast. The frame will arrive and invalidate too, but
     * waiting for a round trip through the room to see your own channel appear would make creating one feel
     * slower than it is — and the two paths converge on the same query, so a double refresh costs one fetch.
     */
    refreshRooms()
    props.onCreated(exit.value.id)
  }, [create, name, props, refreshRooms])

  return (
    <div className="flex flex-col gap-2">
      <form
        method="post"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        className="flex gap-2"
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New channel"
          aria-label="New channel name"
          disabled={!hydrated}
        />
        <Button type="submit" variant="secondary" size="sm" className="h-8" disabled={!hydrated || name.trim() === ""}>
          Create
        </Button>
      </form>
      {rejected === undefined ? null : <Notice tone="error">{rejected}</Notice>}
    </div>
  )
}
