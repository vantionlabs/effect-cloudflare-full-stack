/**
 * Settings for the organization: who is on the team, what it is called, and the API keys that connect other systems.
 *
 * Owners and admins manage; everybody else reads the same page without the controls, with one sentence saying who can
 * change it — better-auth enforces the rule on every request, and the page only declines to offer what would fail.
 * Every change runs in the browser and then re-reads the page from the server (`use-settings-action.ts`); while that
 * happens the current content stays, dimmed, rather than blanking into a spinner.
 */
import { Notice } from "@/components/feedback/notice"
import { Page, PageHeader, PageSection } from "@/components/layout/page"
import { superseded } from "@/lib/motion"
import { useRouterState } from "@tanstack/react-router"
import { canManage, type SettingsView } from "./api/settings-view.ts"
import { ApiKeys } from "./components/api-keys.tsx"
import { InvitationList } from "./components/invitation-list.tsx"
import { InviteForm } from "./components/invite-form.tsx"
import { MemberList } from "./components/member-list.tsx"
import { OrganizationForm } from "./components/organization-form.tsx"
import { roleLabel } from "./components/role-label.ts"
import { SettingsNav } from "./components/settings-nav.tsx"

export function SettingsPage(props: { readonly view: SettingsView }) {
  const refreshing = useRouterState({ select: (state) => state.status === "pending" })
  const { view } = props

  if (view._tag === "Unavailable") {
    return (
      <Page>
        <PageHeader title="Instellingen" />
        <Notice tone="error">{view.reason}</Notice>
      </Page>
    )
  }

  const manage = canManage(view.me.role)
  return (
    <Page>
      <PageHeader
        title="Instellingen"
        description={
          <>
            Team, organisatie en API-sleutels van{" "}
            <strong className="font-medium text-ink">{view.organization.name}</strong>. Jouw rol:{" "}
            {roleLabel(view.me.role)}.
          </>
        }
      />
      <div className="grid gap-8 md:grid-cols-[10rem_minmax(0,1fr)]">
        <SettingsNav />
        <div className="flex min-w-0 flex-col gap-10" style={superseded(refreshing)} aria-busy={refreshing}>
          <PageSection
            id="team"
            title="Team"
            description={manage
              ? "Nodig collega's uit, wijzig hun rol of verwijder ze uit de organisatie."
              : "Alleen eigenaren en beheerders kunnen mensen uitnodigen, rollen wijzigen of leden verwijderen."}
          >
            <div className="flex flex-col gap-6">
              {manage ? <InviteForm /> : null}
              <div className="flex flex-col gap-2">
                <h3 className="text-[13px] font-medium text-ink-2">Leden · {view.members.length}</h3>
                <MemberList members={view.members} me={view.me} manage={manage} />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-[13px] font-medium text-ink-2">
                  Openstaande uitnodigingen · {view.invitations.length}
                </h3>
                <InvitationList invitations={view.invitations} manage={manage} />
              </div>
            </div>
          </PageSection>

          <PageSection id="organisatie" title="Organisatie">
            <OrganizationForm name={view.organization.name} manage={manage} />
          </PageSection>

          <PageSection
            id="api-sleutels"
            title="API-sleutels"
            description="Sleutels waarmee een ander systeem de API van effect-ai aanroept, namens jou en binnen deze organisatie."
          >
            <ApiKeys keys={view.apiKeys} organizationId={view.organization.id} />
          </PageSection>
        </div>
      </div>
    </Page>
  )
}
