/**
 * My account — the person, not the organization: name, password, how the console looks, and signing out. Outside the
 * dashboard layout on purpose (`routes/account.tsx`).
 */
import { useIdentity } from "@/hooks/use-session"
import type { ReactNode } from "react"
import { AccountFrame, AccountSection } from "./components/account-frame.tsx"
import { PasswordForm } from "./components/password-form.tsx"
import { ProfileForm } from "./components/profile-form.tsx"
import { ThemeChoice } from "./components/theme-choice.tsx"

/** `signOut` is passed in by the route: the control belongs to the auth feature, and features do not import each other. */
export function AccountPage(props: { readonly signOut: ReactNode }) {
  const identity = useIdentity()
  return (
    <AccountFrame>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Mijn account</h1>
        <p className="text-sm text-ink-2">Ingelogd als {identity.email}.</p>
      </div>
      <AccountSection id="profiel" title="Profiel" description="Zo zien je collega's je in het team en bij berichten.">
        <ProfileForm name={identity.name ?? ""} email={identity.email} />
      </AccountSection>
      <AccountSection id="wachtwoord" title="Wachtwoord">
        <PasswordForm />
      </AccountSection>
      <AccountSection
        id="weergave"
        title="Weergave"
        description="Licht, donker, of wat je apparaat gebruikt. Alleen in deze browser."
      >
        <ThemeChoice />
      </AccountSection>
      <AccountSection id="sessie" title="Uitloggen" description="Op dit apparaat. Je gegevens blijven bewaard.">
        <div>
          {props.signOut}
        </div>
      </AccountSection>
    </AccountFrame>
  )
}
