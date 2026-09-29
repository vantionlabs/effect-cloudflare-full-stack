/**
 * The root route, which under SSR owns the whole HTML document.
 *
 * As an SPA this was a `<div>` inside a hand-written `index.html`. With Start the server renders the
 * document itself, so `<html>`, `<head>` and `<body>` live here — and `index.html` is gone, because two
 * sources for the shell is one more than can be kept in step.
 *
 * `<HeadContent />` is where per-route `head()` output lands; `<Scripts />` is where the client bundle
 * goes. Omitting either produces a page that renders on the server and never hydrates, which looks like
 * "React is broken" rather than "a tag is missing".
 */
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getCurrentSession } from "../auth/current-session.ts"
import appCss from "../styles.css?url"

export const Route = createRootRoute({
  /*
   * Resolved ONCE per request, at the root, and handed to every child through router context.
   *
   * This is what makes the guards in `_authenticated` and `_guest` plain comparisons rather than fetches:
   * they read `context.session` synchronously. Doing it per-guard would mean one `/api/v1/me` call per
   * layout in the matched tree, for an answer that cannot change mid-render.
   */
  beforeLoad: async () => ({ session: await getCurrentSession() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "effect-ai console" }
    ],
    links: [{ rel: "stylesheet", href: appCss }]
  }),
  shellComponent: RootDocument,
  component: () => <Outlet />
})

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <HeadContent />
      </head>
      <body className="h-full bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
