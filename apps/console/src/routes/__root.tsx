import { createRootRoute, Outlet } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: () => (
    <div style={{ fontFamily: "ui-sans-serif, system-ui", margin: 0 }}>
      <Outlet />
    </div>
  )
})
