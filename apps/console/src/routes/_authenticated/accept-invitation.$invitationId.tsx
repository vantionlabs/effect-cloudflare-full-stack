/**
 * `/accept-invitation/$invitationId` — see `features/auth/accept-invitation-page.tsx`.
 *
 * Under `_authenticated` because both actions need a session. The loader resolves the invitation on the server, so
 * the HTML that arrives already names the inviter or says why it cannot be accepted.
 */
import { AcceptInvitationPage } from "@/features/auth/accept-invitation-page"
import { getInvitation } from "@/features/auth/api/invitation"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/accept-invitation/$invitationId")({
  loader: ({ params }) => getInvitation({ data: { invitationId: params.invitationId } }),
  component: AcceptInvitationRoute
})

function AcceptInvitationRoute() {
  const { invitationId } = Route.useParams()
  return <AcceptInvitationPage invitationId={invitationId} invitation={Route.useLoaderData()} />
}
