/** The person's name — shown to their team in Settings and on what they post. The email is the sign-in, read-only. */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/features/auth/api/auth-client"
import { authErrorMessage } from "@/features/auth/api/auth-errors"
import { useHydrated } from "@/hooks/use-hydrated"
import { useRouter } from "@tanstack/react-router"
import { useState } from "react"

export function ProfileForm(props: { readonly name: string; readonly email: string }) {
  const hydrated = useHydrated()
  const router = useRouter()
  const [name, setName] = useState(props.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const unchanged = name.trim() === props.name || name.trim() === ""

  return (
    <form
      method="post"
      className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)
        setSaved(false)
        const result = await authClient.updateUser({ name: name.trim() })
        if (result.error !== null && result.error !== undefined) {
          setError(authErrorMessage(result.error, "Je naam kon niet worden opgeslagen."))
        } else {
          // Re-reads the session at the root, so the shell and Settings show the new name too.
          await router.invalidate()
          setSaved(true)
        }
        setBusy(false)
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="account-name">Naam</Label>
        <Input
          id="account-name"
          required
          maxLength={100}
          autoComplete="name"
          value={name}
          disabled={!hydrated}
          onChange={(event) => {
            setSaved(false)
            setName(event.target.value)
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="account-email">E-mailadres</Label>
        <Input id="account-email" value={props.email} readOnly aria-describedby="account-email-hint" />
        <p id="account-email-hint" className="text-[12px] text-ink-3">
          Hiermee log je in. Het kan hier niet worden gewijzigd.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" type="submit" disabled={!hydrated || busy || unchanged}>
          {busy ? "Opslaan…" : "Naam opslaan"}
        </Button>
        {saved ? <p role="status" className="text-[13px] text-green">Opgeslagen.</p> : null}
      </div>
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}
    </form>
  )
}
