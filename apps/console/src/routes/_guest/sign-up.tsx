/** `/sign-up` — see `features/auth/sign-up-page.tsx`. */
import { validateNext } from "@/features/auth/api/next-path"
import { SignUpPage } from "@/features/auth/sign-up-page"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_guest/sign-up")({
  validateSearch: validateNext,
  component: () => <SignUpPage next={Route.useSearch().next} />
})
