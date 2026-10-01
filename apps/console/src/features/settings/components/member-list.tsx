/**
 * The people in the organization. Managers (owner, admin) can change a role or remove someone; everybody else sees
 * the same list without the controls, because the server would refuse them anyway.
 *
 * Not offered, because better-auth refuses them and an offered control that always fails is a trap: changing your
 * OWN role or removing yourself, and an admin touching an owner. The last-owner rule is left to the server (it is the
 * only one that can count owners at the moment of the change) and its refusal is shown in Dutch.
 */
import { DataTable } from "@/components/data/data-table"
import { StatusPill } from "@/components/data/status-pill"
import { Notice } from "@/components/feedback/notice"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { authClient } from "@/features/auth/api/auth-client"
import { useHydrated } from "@/hooks/use-hydrated"
import { formatDay } from "@/lib/format"
import { ASSIGNABLE_ROLES, type MemberView } from "../api/settings-view.ts"
import { useSettingsAction } from "../api/use-settings-action.ts"
import { ConfirmAction } from "./confirm-action.tsx"
import { roleTitle } from "./role-label.ts"

const isOwner = (role: string) => role.split(",").includes("owner")

export function MemberList(props: {
  readonly members: ReadonlyArray<MemberView>
  readonly me: { readonly userId: string; readonly role: string }
  readonly manage: boolean
}) {
  const hydrated = useHydrated()
  const { busy, error, run } = useSettingsAction()
  const iAmOwner = isOwner(props.me.role)
  const editable = (member: MemberView) =>
    props.manage && member.userId !== props.me.userId && (iAmOwner || !isOwner(member.role))

  return (
    <div className="flex flex-col gap-2">
      {error === undefined ? null : <Notice tone="error">{error}</Notice>}
      <DataTable
        caption="Leden"
        rows={props.members}
        rowKey={(member) => member.id}
        rowTestId="member"
        empty="Nog geen leden."
        columns={[
          {
            key: "name",
            header: "Naam",
            cell: (member) => (
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-ink">
                  {member.name || member.email}
                  {member.userId === props.me.userId ? <span className="font-normal text-ink-3">(jij)</span> : null}
                </span>
                <span className="truncate text-[12px] text-ink-3">{member.email}</span>
              </span>
            )
          },
          {
            key: "role",
            header: "Rol",
            cell: (member) =>
              editable(member) && !isOwner(member.role)
                ? (
                  <NativeSelect
                    size="sm"
                    aria-label={`Rol van ${member.email}`}
                    value={member.role}
                    disabled={!hydrated || busy}
                    onChange={(event) =>
                      void run(
                        () =>
                          authClient.organization.updateMemberRole({
                            memberId: member.id,
                            // Our roles, not better-auth's typed defaults — see `invite-form.tsx`.
                            role: event.target.value as "admin"
                          }),
                        "De rol kon niet worden gewijzigd."
                      )}
                  >
                    {ASSIGNABLE_ROLES.map((role) => (
                      <NativeSelectOption key={role} value={role}>{roleTitle(role)}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                )
                : <StatusPill tone={isOwner(member.role) ? "accent" : "neutral"}>{roleTitle(member.role)}</StatusPill>
          },
          {
            key: "joined",
            header: "Lid sinds",
            className: "whitespace-nowrap",
            cell: (member) => formatDay(member.joinedAt)
          },
          {
            key: "actions",
            header: <span className="sr-only">Acties</span>,
            align: "right",
            cell: (member) =>
              editable(member)
                ? (
                  <ConfirmAction
                    label="Verwijderen"
                    confirmLabel="Ja, verwijderen"
                    accessibleLabel={`Verwijderen: ${member.email}`}
                    disabled={!hydrated || busy}
                    onConfirm={() =>
                      void run(
                        () => authClient.organization.removeMember({ memberIdOrEmail: member.id }),
                        "Dit lid kon niet worden verwijderd."
                      )}
                  />
                )
                : null
          }
        ]}
      />
    </div>
  )
}
