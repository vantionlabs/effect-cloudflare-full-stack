# X-API-Key: a second auth path resolving to the same Identity

Status: done

Today the only way to authenticate is a better-auth session cookie, which a browser gets by signing in. So
**no third party can call this API at all** — including the Laravel consumer that is the stated reason the
product is API-first.

`docs/PLAN.md` is specific about the shape: _"`X-API-Key` (SHA-256 hashed, shown once) resolves to the **same**
`CurrentUser` as the cookie. CORS returns for the API-key path only."_

## Why "the same Identity" is the whole design

`CurrentUser` has no default, so every store method carries it in `R` and a handler that forgot authentication
does not compile. A second auth path must satisfy that same tag rather than introduce a parallel one: two
identity types would mean every use case either accepts both or silently works for one caller and not the
other. `@ea/domain/Identity` already holds `IdentityResolver` as the port, and `@ea/better-auth` implements it
— so an API-key resolver is a second implementation of an existing port, which is what makes this tractable.

## What it needs before building

- **A table of hashed keys**, keyed by organization, with SHA-256 and a shown-once plaintext. Never reversible,
  never logged, and the lookup is by hash so a leaked database row is not a credential.
- **A role.** `Identity` carries `MemberRole`, and a key is not a member — so either a key names the member it
  acts as, or the closed role set gains a machine role. That decision belongs in an ADR, because "what can a
  key do" is a permissions question and the wrong answer is to give every key `owner`.
- **Rate limiting per key**, which is `.scratch/chat-realtime/issues/08-rate-limit-durable-object.md` and the
  one place PLAN says a Durable Object genuinely earns its keep: a contractual "1,000 per hour" is accounting,
  which Cloudflare's rate-limit binding explicitly is not for.
- **CORS, for this path only.** The first-party path deletes CORS on purpose (same origin, no trusted-origins
  list to get subtly wrong); a key-authenticated path is cross-origin by nature and needs it back, scoped to
  that path so the two cannot be confused.
- **`HttpApiSecurity`** so the scheme appears in the OpenAPI document, or the docs page tells a client the API
  needs a cookie it cannot get.

## Comments

Confirmed for **stage D**, in the same pass as the endpoints rather than after them: 17 paths reachable only
by a session cookie would be unusable by the client they are for.

The open decision this issue names — a key is not a member, but `Identity` carries `MemberRole` — is now the
first thing to settle, and it needs an ADR because "what can a key do" is an authorisation question with an
audit consequence: a key that can approve a payment while recording a human's name in `approved_by` is worse
than one that cannot approve at all.

Done. A key authenticates a REST request with no cookie, no session and no browser — asserted for a read and a
write, as `X-API-Key` and as `Authorization: Bearer`.

**The open question this issue named is answered in ADR-0022: a key ACTS AS a member.** No machine role, no
synthetic user. `acts_as_user_id` names the person, membership is joined on every request rather than copied — so
removing somebody from an organization revokes their keys with them — and `approved_by` stays a real person, which
is what makes a program's approval attributable.

Also here: `POST /api-keys`, `GET /api-keys`, `DELETE /api-keys/{id}` (revoke, idempotent, never deletes the row).
22 operations in the document now.

**A test caught the one thing I had documented and not implemented.** The middleware fell through to the cookie
when a key was present and wrong — so a browser with a broken key kept working, as whoever was signed in. A client
would have seen 200s, believed its key worked, and been writing under somebody else's identity. It refuses now,
and the test is the contract.

Three things this issue asked for that were NOT done, each for a stated reason:

- **`HttpApiSecurity` in the document** — `.scratch/rest-api/issues/06`. Supplying `security` changes the
  middleware's shape, and refactoring the one seam every protected endpoint goes through, twice in one pass, on a
  shape not yet verified, is how a subtle auth bug ships. The document's description says what to send in the
  meantime.
- **CORS for the key path** — deliberately not added, against `PLAN.md`. A key-authenticated caller is
  server-to-server and does not need CORS; enabling it would invite putting a bearer credential into frontend
  code, where it cannot be kept.
- **Per-key rate limiting** — still `.scratch/chat-realtime/issues/08`, and now it has a real key to limit.
