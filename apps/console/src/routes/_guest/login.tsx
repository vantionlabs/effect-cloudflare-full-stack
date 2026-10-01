/** `/login` — see `features/auth/login-page.tsx`. */
import { validateNext } from "@/features/auth/api/next-path"
import { LoginPage } from "@/features/auth/login-page"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_guest/login")({
  validateSearch: validateNext,
  component: () => <LoginPage next={Route.useSearch().next} />
})
