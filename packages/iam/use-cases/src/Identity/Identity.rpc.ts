/**
 * The transport edge for the authenticated group.
 *
 * Note what is absent: no session handling, no header parsing, no organization lookup. All of
 * that happened in `AuthenticatedLive`, so the handler simply reads the identity the middleware
 * provided. A handler that tried to authenticate itself would be a second seam.
 */
import { MeV1 } from "@ea/iam-domain/Identity"
import { ApiV1 } from "@ea/shared-api/V1"
import { CurrentUser } from "@ea/shared-domain/Identity"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const IdentityRpc = HttpApiBuilder.group(
  ApiV1,
  "me",
  (handlers) =>
    handlers.handle("get", () =>
      Effect.map(CurrentUser, (identity) =>
        new MeV1({
          user_id: identity.userId,
          email: identity.email,
          organization_id: identity.orgId,
          role: identity.role
        })))
)
