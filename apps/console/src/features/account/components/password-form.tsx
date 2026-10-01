/**
 * Change the password. Other sessions are signed out (`revokeOtherSessions`): changing a password is usually a
 * response to "someone else may know it", and a change that leaves their session alive answers nothing.
 */
import { Button } from "@/components/atoms/Button"
import { Notice } from "@/components/feedback/notice"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/features/auth/api/auth-client"
import { authErrorMessage } from "@/features/auth/api/auth-errors"
import { useHydrated } from "@/hooks/use-hydrated"
import { useState } from "react"

/** better-auth's default minimum; checked here only to say so before the round trip. */
const MIN_LENGTH = 8

export function PasswordForm() {
  const hydrated = useHydrated()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [repeat, setRepeat] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [changed, setChanged] = useState(false)

  const mismatch = repeat !== "" && repeat !== next
  const tooShort = next !== "" && next.length < MIN_LENGTH

  return (
    <form
      method="post"
      className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card"
      onSubmit={async (event) => {
        event.preventDefault()
        if (mismatch || tooShort) return
        setBusy(true)
        setError(undefined)
        setChanged(false)
        const result = await authClient.changePassword({
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: true
        })
        if (result.error !== null && result.error !== undefined) {
          setError(authErrorMessage(result.error, "Je wachtwoord kon niet worden gewijzigd."))
        } else {
          setChanged(true)
          setCurrent("")
          setNext("")
          setRepeat("")
        }
        setBusy(false)
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password-current">Huidig wachtwoord</Label>
        <Input
          id="password-current"
          type="password"
          required
          autoComplete="current-password"
          value={current}
          disabled={!hydrated}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password-new">Nieuw wachtwoord</Label>
          <Input
            id="password-new"
            type="password"
            required
            autoComplete="new-password"
            aria-invalid={tooShort || undefined}
            aria-describedby="password-new-hint"
            value={next}
            disabled={!hydrated}
            onChange={(event) => setNext(event.target.value)}
          />
          <p id="password-new-hint" className={tooShort ? "text-[12px] text-red" : "text-[12px] text-ink-3"}>
            Minstens {MIN_LENGTH} tekens.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password-repeat">Herhaal nieuw wachtwoord</Label>
          <Input
            id="password-repeat"
            type="password"
            required
            autoComplete="new-password"
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? "password-repeat-hint" : undefined}
            value={repeat}
            disabled={!hydrated}
            onChange={(event) => setRepeat(event.target.value)}
          />
          {mismatch ? <p id="password-repeat-hint" className="text-[12px] text-red">Komt niet overeen.</p> : null}
        </div>
      </div>
      <p className="text-[12px] text-ink-3">Je blijft hier ingelogd; op andere apparaten word je uitgelogd.</p>
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          type="submit"
          disabled={!hydrated || busy || current === "" || next === "" || repeat === "" || mismatch || tooShort}
        >
          {busy ? "Wijzigen…" : "Wachtwoord wijzigen"}
        </Button>
        {changed ? <p role="status" className="text-[13px] text-green">Wachtwoord gewijzigd.</p> : null}
      </div>
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}
    </form>
  )
}
