/**
 * Runs one change on the settings page: call better-auth from the browser, then re-read the page.
 *
 * `router.invalidate()` re-runs the route's loader, so the lists come back from the server exactly as stored —
 * nothing is patched into local state that could disagree with it. While that runs the page keeps showing what it
 * had (dimmed, see `settings-page.tsx`) rather than blanking; a refusal is kept for the control that caused it.
 */
import { useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { settingsErrorMessage } from "./settings-errors.ts"

interface Outcome<A> {
  readonly data?: A | null | undefined
  readonly error?: { readonly code?: string | undefined; readonly message?: string | undefined } | null | undefined
}

export const useSettingsAction = () => {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const run = async <A>(action: () => Promise<Outcome<A>>, fallback: string): Promise<A | undefined> => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await action()
      if (result.error !== null && result.error !== undefined) {
        setError(settingsErrorMessage(result.error, fallback))
        // A stale row (removed elsewhere) is the usual cause of a "not found"; re-reading puts the page right.
        await router.invalidate()
        return undefined
      }
      await router.invalidate()
      return (result.data ?? undefined) as A | undefined
    } catch {
      setError(fallback)
      return undefined
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, run, clearError: () => setError(undefined) }
}
