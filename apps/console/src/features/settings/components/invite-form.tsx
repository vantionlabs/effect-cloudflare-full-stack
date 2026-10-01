/**
 * Invite someone by email, in one of the roles this product knows. The invitee gets an email with a link to
 * `/accept-invitation/<id>` (built by the server, `BetterAuth.ts`) and joins the team when they accept.
 */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { authClient } from "@/features/auth/api/auth-client"
import { useHydrated } from "@/hooks/use-hydrated"
import { useState } from "react"
import { ASSIGNABLE_ROLES } from "../api/settings-view.ts"
import { useSettingsAction } from "../api/use-settings-action.ts"
import { roleTitle } from "./role-label.ts"

export function InviteForm() {
  const hydrated = useHydrated()
  const { busy, error, run } = useSettingsAction()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>("reviewer")
  const [sentTo, setSentTo] = useState<string | undefined>(undefined)

  return (
    <form
      method="post"
      className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card"
      onSubmit={async (event) => {
        event.preventDefault()
        setSentTo(undefined)
        const address = email.trim()
        const invited = await run(
          // `role` is one of OUR roles; better-auth's client types only its own defaults, and the server's role
          // guard (`Roles.ts`) is what decides, so the cast is to the client's parameter type and nothing more.
          () => authClient.organization.inviteMember({ email: address, role: role as "admin" }),
          "De uitnodiging kon niet worden verstuurd."
        )
        if (invited !== undefined) {
          setSentTo(address)
          setEmail("")
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">E-mailadres</Label>
          <Input
            id="invite-email"
            type="email"
            required
            autoComplete="off"
            placeholder="naam@bedrijf.nl"
            value={email}
            disabled={!hydrated}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Rol</Label>
          <NativeSelect
            id="invite-role"
            className="w-full"
            value={role}
            disabled={!hydrated}
            onChange={(event) => setRole(event.target.value as (typeof ASSIGNABLE_ROLES)[number])}
          >
            {ASSIGNABLE_ROLES.map((option) => (
              <NativeSelectOption key={option} value={option}>{roleTitle(option)}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button variant="primary" type="submit" disabled={!hydrated || busy || email.trim() === ""}>
          {busy ? "Versturen…" : "Uitnodigen"}
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        Eigenaren en beheerders beheren het team en de organisatie; beoordelaars en lezers niet. De uitnodiging is een
        e-mail met een link en verloopt na 48 uur.
      </p>
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}
      {sentTo === undefined
        ? null
        : (
          <p role="status" className="text-[13px] text-green" style={{ animation: "fade-in 200ms ease-out both" }}>
            Uitnodiging verstuurd naar {sentTo}.
          </p>
        )}
    </form>
  )
}
