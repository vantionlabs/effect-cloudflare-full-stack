/**
 * Whether the client has taken over from the server-rendered HTML.
 *
 * `false` during SSR and on the first client render, `true` after the first effect. That ordering is the
 * whole point: an effect does not run on the server, so the value differs between the two renders by
 * design, and React's hydration compares only the FIRST client render against the server's output — so
 * there is no mismatch to warn about.
 *
 * It exists because a server-rendered form is real HTML the moment it reaches the browser, and a browser
 * will happily submit real HTML before any JavaScript has loaded. Everything that assumes a React handler
 * will intercept a submit is wrong for that window. On the login form the consequence was concrete and bad:
 * a click in that window submitted natively, and since a form with no `method` defaults to GET, the
 * password was appended to the URL — into history, into the referrer of the next request, and into every
 * access log in front of the app. Found by the e2e suite, which raced hydration by accident.
 *
 * Use it to gate anything whose degraded behaviour is worse than nothing. Do NOT use it to hide content:
 * that throws away the server rendering this app went to some trouble to get.
 */
import { useEffect, useState } from "react"

export const useHydrated = (): boolean => {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  return hydrated
}
