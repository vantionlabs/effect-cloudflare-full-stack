# The per-key quota

Measured 2026-10-01. It **works** — better-auth's api-key plugin counts every authenticated request on the
`apikey` row and refuses the one past the ceiling. 1,000 an hour per key, configured in `BetterAuth.ts`.

Two conclusions:

- **The Durable Object the plan wanted is not needed.** PLAN.md calls a per-key DO "the one place a Durable
  Object genuinely earns its keep", because Cloudflare's rate-limit binding is per-colo and documented as
  not an accounting system. That reasoning predates ADR-0022: better-auth counts in Postgres, per key,
  exactly and durably. A DO would be a second counter disagreeing with this one.
- **One real defect remains**: a breach answers 401 instead of 429. See `issues/01`.
