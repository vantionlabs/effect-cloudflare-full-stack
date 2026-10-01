/** The organization's name — what invitations and the weekly email call it. Owners and admins may change it. */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/features/auth/api/auth-client"
import { useHydrated } from "@/hooks/use-hydrated"
import { useState } from "react"
import { useSettingsAction } from "../api/use-settings-action.ts"

export function OrganizationForm(props: { readonly name: string; readonly manage: boolean }) {
  const hydrated = useHydrated()
  const { busy, error, run } = useSettingsAction()
  const [name, setName] = useState(props.name)
  const [saved, setSaved] = useState(false)
  const unchanged = name.trim() === props.name || name.trim() === ""

  return (
    <form
      method="post"
      className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card"
      onSubmit={async (event) => {
        event.preventDefault()
        setSaved(false)
        const updated = await run(
          () => authClient.organization.update({ data: { name: name.trim() } }),
          "De naam kon niet worden opgeslagen."
        )
        if (updated !== undefined) setSaved(true)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="organization-name">Naam</Label>
          <Input
            id="organization-name"
            required
            maxLength={100}
            value={name}
            readOnly={!props.manage}
            disabled={!hydrated}
            onChange={(event) => {
              setSaved(false)
              setName(event.target.value)
            }}
          />
        </div>
        {props.manage
          ? (
            <Button variant="primary" type="submit" disabled={!hydrated || busy || unchanged}>
              {busy ? "Opslaan…" : "Opslaan"}
            </Button>
          )
          : null}
      </div>
      <p className="text-[12px] text-ink-3">
        {props.manage
          ? "Deze naam staat in uitnodigingen en in de wekelijkse e-mail met de cijfers."
          : "Alleen eigenaren en beheerders kunnen de naam wijzigen."}
      </p>
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}
      {saved ? <p role="status" className="text-[13px] text-green">Naam opgeslagen.</p> : null}
    </form>
  )
}
