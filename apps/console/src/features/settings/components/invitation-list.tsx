/**
 * Invitations sent and not yet answered. Managers can send one again (a fresh email and a fresh expiry) or withdraw
 * it; the link in an withdrawn invitation stops working.
 */
import { Button } from "@/components/atoms/Button"
import { DataTable } from "@/components/data/data-table"
import { StatusPill } from "@/components/data/status-pill"
import { Notice } from "@/components/feedback/notice"
import { authClient } from "@/features/auth/api/auth-client"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatDay } from "@/lib/format"
import { useState } from "react"
import type { InvitationRow } from "../api/settings-view.ts"
import { useSettingsAction } from "../api/use-settings-action.ts"
import { ConfirmAction } from "./confirm-action.tsx"
import { roleTitle } from "./role-label.ts"

export function InvitationList(
  props: { readonly invitations: ReadonlyArray<InvitationRow>; readonly manage: boolean }
) {
  const hydrated = useHydrated()
  const { busy, error, run } = useSettingsAction()
  const [resent, setResent] = useState<string | undefined>(undefined)

  return (
    <div className="flex flex-col gap-2">
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}
      {resent === undefined
        ? null
        : <p role="status" className="text-[13px] text-green">Opnieuw verstuurd naar {resent}.</p>}
      <DataTable
        caption="Openstaande uitnodigingen"
        rows={props.invitations}
        rowKey={(invitation) => invitation.id}
        rowTestId="invitation"
        empty={props.manage
          ? "Geen openstaande uitnodigingen. Nodig hierboven iemand uit; na het accepteren staat diegene bij de leden."
          : "Geen openstaande uitnodigingen."}
        columns={[
          { key: "email", header: "E-mailadres", cell: (invitation) => invitation.email },
          {
            key: "role",
            header: "Rol",
            cell: (invitation) => <StatusPill tone="neutral">{roleTitle(invitation.role)}</StatusPill>
          },
          {
            key: "by",
            header: "Uitgenodigd door",
            cell: (invitation) =>
              invitation.invitedBy === null
                ? "—"
                : <span className="block max-w-40 truncate" title={invitation.invitedBy}>{invitation.invitedBy}</span>
          },
          {
            key: "expires",
            header: "Verloopt",
            className: "whitespace-nowrap",
            cell: (invitation) => formatDay(invitation.expiresAt)
          },
          {
            key: "actions",
            header: <span className="sr-only">Acties</span>,
            align: "right",
            cell: (invitation) =>
              props.manage
                ? (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <Button
                      variant="quiet"
                      size="xs"
                      disabled={!hydrated || busy}
                      aria-label={`Opnieuw versturen: ${invitation.email}`}
                      onClick={async () => {
                        setResent(undefined)
                        const sent = await run(
                          () =>
                            authClient.organization.inviteMember({
                              email: invitation.email,
                              role: invitation.role as "admin",
                              resend: true
                            }),
                          "De uitnodiging kon niet opnieuw worden verstuurd."
                        )
                        if (sent !== undefined) setResent(invitation.email)
                      }}
                    >
                      Opnieuw versturen
                    </Button>
                    <ConfirmAction
                      label="Intrekken"
                      confirmLabel="Ja, intrekken"
                      accessibleLabel={`Intrekken: ${invitation.email}`}
                      disabled={!hydrated || busy}
                      onConfirm={() =>
                        void run(
                          () => authClient.organization.cancelInvitation({ invitationId: invitation.id }),
                          "De uitnodiging kon niet worden ingetrokken."
                        )}
                    />
                  </span>
                )
                : null
          }
        ]}
      />
    </div>
  )
}
