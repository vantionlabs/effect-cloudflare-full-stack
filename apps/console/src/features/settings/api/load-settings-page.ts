/**
 * The settings page's data, read ON THE SERVER by the route loader — so the HTML that arrives already lists the team,
 * the invitations and the keys, and a client navigation runs the same function as a server-function call.
 *
 * Reads only: a GET through better-auth's client with the visitor's own headers, the pattern of
 * `features/auth/api/invitation.ts`. Every change (invite, revoke, rename) is a mutation and runs in the browser,
 * because a server-side call carries no `Origin` for better-auth's CSRF check (see `auth-client.ts`).
 *
 * The caller's role comes from better-auth too (`getActiveMember`), not from the page: the page uses it only to
 * decide which controls to OFFER. The server enforces the same rule on every mutation regardless.
 */
import { authClient } from "@/features/auth/api/auth-client"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import type { ApiKeyView, InvitationRow, MemberView, SettingsView } from "./settings-view.ts"

const text = (value: unknown): string => typeof value === "string" ? value : ""
const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : typeof value === "string" ? value : ""

export const loadSettingsPage = createServerFn({ method: "GET" }).handler(async (): Promise<SettingsView> => {
  const fetchOptions = { headers: getRequest().headers }
  const [full, active, keys] = await Promise.all([
    authClient.organization.getFullOrganization({ fetchOptions }),
    authClient.organization.getActiveMember({ fetchOptions }),
    authClient.apiKey.list({ fetchOptions })
  ])

  if (full.data === null || full.data === undefined || active.data === null || active.data === undefined) {
    return {
      _tag: "Unavailable",
      reason: full.error?.message ?? active.error?.message ?? "Er is geen actieve organisatie voor deze sessie."
    }
  }

  const organization = full.data
  const members: Array<MemberView> = organization.members.map((member) => ({
    id: member.id,
    userId: member.userId,
    name: text(member.user.name),
    email: text(member.user.email),
    role: text(member.role),
    joinedAt: iso(member.createdAt)
  }))
  const emailOf = new Map(members.map((member) => [member.userId, member.email]))
  const invitations: Array<InvitationRow> = organization.invitations
    .filter((invitation) => invitation.status === "pending")
    .map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: text(invitation.role),
      invitedBy: emailOf.get(invitation.inviterId) ?? null,
      expiresAt: iso(invitation.expiresAt)
    }))

  /*
   * A key belongs to its USER and names its organization in metadata (see `BetterAuth.ts`, `references: "user"`), so
   * the list is this person's keys, filtered to the organization they are looking at.
   */
  const listed = (keys.data as { readonly apiKeys?: ReadonlyArray<Record<string, unknown>> } | null | undefined)
    ?.apiKeys ?? []
  const apiKeys: Array<ApiKeyView> = listed
    .filter((key) => {
      const metadata = typeof key["metadata"] === "string"
        ? (JSON.parse(key["metadata"]) as Record<string, unknown> | null)
        : key["metadata"] as Record<string, unknown> | null | undefined
      return metadata?.["organizationId"] === organization.id
    })
    .map((key) => ({
      id: text(key["id"]),
      name: text(key["name"]) || "Naamloos",
      start: typeof key["start"] === "string" ? key["start"] : null,
      createdAt: iso(key["createdAt"]),
      lastUsedAt: key["lastRequest"] === null || key["lastRequest"] === undefined ? null : iso(key["lastRequest"])
    }))
  // Newest first. `sort` on the array `map` just built, so nothing shared is mutated (the console targets ES2022,
  // which has no `toSorted`).
  // oxlint-disable-next-line unicorn/no-array-sort
  apiKeys.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return {
    _tag: "Ready",
    organization: { id: organization.id, name: organization.name },
    me: { userId: active.data.userId, role: text(active.data.role) },
    members,
    invitations,
    apiKeys
  }
})
