# ADR-0022 — An API key acts as a member, and has no authority of its own

**Status:** accepted · **Date:** 2026-09-30

## Context

`PLAN.md` settled the shape years before the code existed: _"`X-API-Key` (SHA-256 hashed, shown once) resolves to
the **same** `CurrentUser` as the cookie."_ Building it surfaced the question that sentence does not answer.

`Identity` carries a `MemberRole`, closed to `owner`, `reviewer`, `viewer`. **A key is not a member.** So either
the closed set gains a machine role, or a key names the member it acts as. The choice has an audit consequence
rather than an ergonomic one: `decisions.approved_by` holds a user id, and a decision approved by a program has
to be attributable to somebody.

## Decision

**A key carries `acts_as_user_id` and resolves to that member's `Identity`, role included.** There is no machine
role and no synthetic user.

Three properties follow, and they are the reason:

1. **One `Identity`, so one authorization seam.** Every use case already requires `CurrentUser`; a second
   identity type would mean each one either handles both or works for one caller and not the other. The
   middleware in `packages/api/src/v1/Identity/AuthenticatedLive.ts` is now the only place either credential is
   read, and better-auth is reduced to supplying the `IdentityResolver` port.
2. **Revoking the member revokes the key.** Membership is re-read on every request and joined rather than copied
   into the key's row, so removing somebody from an organization disables their keys without anyone remembering
   to. Offboarding is one action instead of two, and the second action is the one that gets forgotten.
3. **`approved_by` stays a real person.** A program that approves a payment is accountable to the member it acts
   as, which is a truthful record of who authorised the automation.

Two implementation decisions came with it, both argued in the files:

- **SHA-256, not a password hash.** A key is 256 bits from the platform CSPRNG, not a memorable secret — there
  is no dictionary to slow down, and the lookup happens on every request. A deliberately different decision from
  better-auth's password hashing, for a different threat.
- **A presented key never falls through to the cookie.** Found by a test: the first version did, so a browser
  with a broken key kept working as whoever was signed in. Presenting a credential is a claim about who you are,
  so a wrong one is a refusal.

## What this costs, stated plainly

**A key acting as an owner can mint another key.** It has exactly that member's authority, which is consistent —
but nothing in `Identity` records WHICH door a request came through, so a use case cannot refuse a key even where
that would be right. The mitigation today is operational: point a key at a least-privileged member.

Closing it properly means a `via: "session" | "key"` on `Identity`, which is a change to the one type every use
case depends on. Not done here because nothing yet needs it, and because adding a field to that type without a
caller is how a seam accretes.

**No scopes.** A key can do everything its member can. Per-key scopes are a second authorization model, and one
is enough until a client asks for read-only access.

## Revisit when

- **A client asks for a read-only key**, or for a key that may not approve. That is the trigger for scopes, and
  the honest answer until then is that a key is as powerful as the person it acts as.
- **Key-minted keys become a concern.** Then `Identity` gains the door it came through, and the endpoints that
  must not accept a key say so.
- **A key needs to outlive its member.** It would mean a service account, which is a different thing from what
  this ADR describes, and reopening this is the right way to get one.
