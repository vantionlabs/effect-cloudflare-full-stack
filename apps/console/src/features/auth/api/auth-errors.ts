/**
 * better-auth's refusals, in Dutch.
 *
 * Its messages are English and the interface is Dutch (PRODUCT.md), but they carry distinctions worth keeping —
 * "wrong password" is not "account exists" is not "link expired", and the remedy differs for each. So this maps by
 * the error CODE, which is stable, rather than by the English text, and keeps every distinction. An unmapped code
 * falls back to better-auth's own message: an English sentence that says what happened beats a Dutch one that does
 * not.
 *
 * In `api/` because other features may import `features/auth/api` (AGENTS.md), so settings and account screens can
 * say the same thing in the same words.
 */

const MESSAGES: Readonly<Record<string, string>> = {
  INVALID_EMAIL_OR_PASSWORD: "Onjuist e-mailadres of wachtwoord.",
  INVALID_PASSWORD: "Dat wachtwoord klopt niet.",
  INVALID_EMAIL: "Dat is geen geldig e-mailadres.",
  EMAIL_NOT_VERIFIED: "Bevestig eerst je e-mailadres via de link in je mail.",
  PASSWORD_TOO_SHORT: "Dat wachtwoord is te kort.",
  PASSWORD_TOO_LONG: "Dat wachtwoord is te lang.",
  USER_ALREADY_EXISTS: "Er bestaat al een account met dit e-mailadres. Log in of kies een ander adres.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "Er bestaat al een account met dit e-mailadres. Log in of kies een ander adres.",
  INVALID_TOKEN: "Deze link is ongeldig of verlopen. Vraag een nieuwe aan.",
  TOKEN_EXPIRED: "Deze link is verlopen. Vraag een nieuwe aan.",
  SESSION_EXPIRED: "Je sessie is verlopen. Log opnieuw in om dit te doen.",
  INVITATION_NOT_FOUND: "Deze uitnodiging bestaat niet (meer). Vraag degene die je uitnodigde om een nieuwe.",
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
    "Deze uitnodiging is voor een ander e-mailadres. Log uit en log in met het adres waarop je de uitnodiging kreeg.",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: "Je bent al lid van deze organisatie.",
  INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION:
    "Degene die je uitnodigde is geen lid meer van deze organisatie, dus de uitnodiging geldt niet meer.",
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
    "Bevestig eerst je e-mailadres; daarna kun je de uitnodiging accepteren."
}

export interface AuthError {
  readonly code?: string | undefined
  readonly message?: string | undefined
}

/** The Dutch sentence for a better-auth error, or its own message, or `fallback` when it gave neither. */
export const authErrorMessage = (error: AuthError | null | undefined, fallback: string): string => {
  const mapped = error?.code === undefined ? undefined : MESSAGES[error.code]
  return mapped ?? error?.message ?? fallback
}

/** A member's role as the interface names it. */
export const roleLabel = (role: string): string =>
  ({ owner: "eigenaar", admin: "beheerder", reviewer: "beoordelaar", viewer: "lezer" } as Record<string, string>)[role]
    ?? role
