# X-API-Key: a second auth path resolving to the same Identity

Status: ready-for-agent

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
