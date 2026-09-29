/**
 * The router, created by a FUNCTION rather than at module scope.
 *
 * TanStack Start calls `getRouter()` once per request on the server. A router built at module scope would
 * be shared across requests in the same isolate — and a router holds per-navigation state, so on a Worker
 * that means one visitor's pending navigation visible to the next. Same shape as the Worker's own rule
 * about what may be memoised per isolate: bindings yes, anything request-scoped no.
 */
import { RegistryProvider } from "@effect/atom-react"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { routeTree } from "./routeTree.gen.ts"

/**
 * One Effect atom registry per router, wrapping the whole tree.
 *
 * Two components reading the same query then share one in-flight request instead of each firing its own —
 * which is why this wrapper existed in the old client entry and has to survive the move to SSR rather
 * than being dropped with `main.tsx`.
 */
const Wrap = ({ children }: { readonly children: ReactNode }) => <RegistryProvider>{children}</RegistryProvider>

export const getRouter = () => {
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    // Server-rendered: a route that throws should render its error boundary, not a blank document.
    defaultErrorComponent: ({ error }) => <pre>{String(error)}</pre>,
    Wrap
  })
  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
