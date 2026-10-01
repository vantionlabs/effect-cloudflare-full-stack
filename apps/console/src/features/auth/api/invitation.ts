/**
 * An invitation, resolved ON THE SERVER for the accept page — the same shape as `current-session.ts`.
 *
 * The first version fetched it in a `useEffect`, so the page rendered "Loading invitation…", hydrated, and only
 * then asked. That is a client-side auth check: the server sends a page before it knows whether the visitor may
 * see it. Here the route's loader runs this during SSR (and as a server-function call on a client navigation),
 * so the HTML that arrives already says either who invited you or why you cannot accept.
 *
 * A GET, so better-auth's CSRF check — which needs an `Origin` that a server-side call does not have — does not
 * apply; the visitor's headers are forwarded so their session cookie answers "is this invitation yours". Accept
 * and decline are mutations and stay in the browser for exactly that reason (see `auth-client.ts`).
 */
import { authClient } from "@/features/auth/api/auth-client"
import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { Schema } from "effect"

/** A projection, field by field, for the reason given in `current-session.ts`: this is serialised into the HTML. */
export type InvitationView =
  | {
    readonly _tag: "Pending"
    readonly organizationName: string
    readonly inviterEmail: string
    readonly role: string
  }
  | { readonly _tag: "Unavailable"; readonly reason: string }

const Input = Schema.Struct({ invitationId: Schema.String })

export const getInvitation = createServerFn({ method: "GET" })
  .inputValidator(Schema.toStandardSchemaV1(Input))
  .handler(async ({ data }): Promise<InvitationView> => {
    const result = await authClient.organization.getInvitation({
      query: { id: data.invitationId },
      fetchOptions: { headers: getRequest().headers }
    })
    if (result.data === null || result.data === undefined) {
      // better-auth's message distinguishes "not the recipient", "expired" and "not found", and the remedy differs
      // for each (sign in as someone else, ask again, check the link), so it is passed through as-is.
      return { _tag: "Unavailable", reason: result.error?.message ?? "This invitation is no longer available." }
    }
    return {
      _tag: "Pending",
      organizationName: result.data.organizationName,
      inviterEmail: result.data.inviterEmail,
      role: result.data.role
    }
  })
