/**
 * The organization roles better-auth knows, which must be exactly the domain's `MemberRole`.
 *
 * better-auth ships `owner`, `admin` and `member`; this product's roles are `owner`, `admin`, `reviewer` and `viewer`.
 * An invitation in better-auth's `member` role signs its invitee in and then 401s every request, because `MemberRole`
 * refuses to decode it. Naming our roles below is NOT enough to prevent that: read in 1.7.6's `crud-invites.mjs`,
 * better-auth always treats its own defaults (`owner`, `admin`, `member`) as valid alongside custom roles. So
 * `productRoleGuard` refuses any other role on the two endpoints that set one.
 *
 * What a role may do to the ORGANIZATION (rename it, invite, change roles, remove members) is better-auth's access
 * control, reused rather than re-implemented: owner and admin keep its owner and admin grants, reviewer and viewer
 * get its member grant, which is none. What a role may do in the PRODUCT (approve a decision) is ours and lives in
 * the domain, not here.
 */
import { APIError, createAuthMiddleware } from "better-auth/api"
import { adminAc, memberAc, ownerAc } from "better-auth/plugins/organization/access"

export const organizationRoles = {
  owner: ownerAc,
  admin: adminAc,
  reviewer: memberAc,
  viewer: memberAc
}

const PRODUCT_ROLES: ReadonlySet<string> = new Set(Object.keys(organizationRoles))
const SETS_A_ROLE = new Set(["/organization/invite-member", "/organization/update-member-role"])

/** A `hooks.before` middleware: a role outside `organizationRoles` is a 400 before better-auth stores anything. */
export const productRoleGuard = createAuthMiddleware(async (ctx) => {
  if (!SETS_A_ROLE.has(ctx.path)) return
  const body = ctx.body as { readonly role?: unknown } | undefined
  const requested = Array.isArray(body?.role) ? body.role : String(body?.role ?? "").split(",")
  const unknown = requested.map((role) => String(role).trim()).filter((role) => !PRODUCT_ROLES.has(role))
  if (unknown.length > 0) {
    throw new APIError("BAD_REQUEST", {
      message: `Unknown role: ${unknown.join(", ")}. Use one of ${[...PRODUCT_ROLES].join(", ")}.`
    })
  }
})
