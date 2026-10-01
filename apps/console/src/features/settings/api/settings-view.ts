/**
 * What the settings page needs, and nothing else — the projection the loader returns.
 *
 * Field by field, for the reason in `features/auth/api/current-session.ts`: this is serialised into the HTML. An API
 * key's secret is never part of it (better-auth's list endpoint does not return it either; only `start`, the first
 * few characters, which is what makes a key recognisable in a list).
 */

/** The four roles of this product (`packages/domain` `MemberRole`). better-auth's `member` is not one. */
export type Role = "owner" | "admin" | "reviewer" | "viewer"

/** The roles an invitation or a role change may set. Never `owner`: ownership is not handed out from a form. */
export const ASSIGNABLE_ROLES: ReadonlyArray<Exclude<Role, "owner">> = ["admin", "reviewer", "viewer"]

export interface MemberView {
  readonly id: string
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly role: string
  readonly joinedAt: string
}

export interface InvitationRow {
  readonly id: string
  readonly email: string
  readonly role: string
  readonly invitedBy: string | null
  readonly expiresAt: string
}

export interface ApiKeyView {
  readonly id: string
  readonly name: string
  /** The first characters of the key, prefix included — never the key itself. */
  readonly start: string | null
  readonly createdAt: string
  readonly lastUsedAt: string | null
}

export type SettingsView =
  | {
    readonly _tag: "Ready"
    readonly organization: { readonly id: string; readonly name: string }
    readonly me: { readonly userId: string; readonly role: string }
    readonly members: ReadonlyArray<MemberView>
    readonly invitations: ReadonlyArray<InvitationRow>
    readonly apiKeys: ReadonlyArray<ApiKeyView>
  }
  | { readonly _tag: "Unavailable"; readonly reason: string }

/** Whether a role may change the team and the organization — better-auth's own grants (owner and admin). */
export const canManage = (role: string): boolean => role.split(",").some((part) => part === "owner" || part === "admin")
