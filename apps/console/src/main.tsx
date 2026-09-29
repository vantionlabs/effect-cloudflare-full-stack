/**
 * The console's entry point.
 *
 * `RegistryProvider` wraps the tree once, so every atom shares one registry — which is what makes two
 * components reading the same query share one in-flight request rather than each firing its own.
 */
import { RegistryProvider } from "@effect/atom-react"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { routeTree } from "./routeTree.gen.ts"

const router = createRouter({ routeTree, defaultPreload: "intent" })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById("app")
if (root === null) throw new Error("#app is missing from index.html")

createRoot(root).render(
  <StrictMode>
    <RegistryProvider>
      <RouterProvider router={router} />
    </RegistryProvider>
  </StrictMode>
)
