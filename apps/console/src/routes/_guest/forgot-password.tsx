/** `/forgot-password` — see `features/auth/forgot-password-page.tsx`. */
import { ForgotPasswordPage } from "@/features/auth/forgot-password-page"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_guest/forgot-password")({ component: ForgotPasswordPage })
