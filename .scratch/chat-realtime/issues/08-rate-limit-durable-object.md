# The rate-limit Durable Object, per API key

Status: ready-for-agent
Blocked by: 04

PLAN.md already decided this: Cloudflare's rate-limit binding is "permissive, eventually consistent, and
intentionally designed to not be used as an accurate accounting system", with a unique limit per location
and periods restricted to 10 s or 60 s — so a customer's contractual "1,000 requests per hour" cannot be
expressed with it, and a DO per key can, exactly because it is single-threaded.

It lands last because it reuses the plumbing the chat work builds, and because it only matters once the API
has third-party keys.

## Shape

- One DO per API key hash. An alarm resets the window — acceptable here, unlike in a room, because this
  object is only alive when the key is in use anyway.
- `effect/persistence` ships a `RateLimiter` with a pluggable store, so the quota logic stays testable
  against a fake and the DO is only the store.
- OTP and sign-in attempts do **not** go here: per-colo counting is unsafe (5 attempts across ~300 colos is
  ~1,500 guesses at a 6-digit code) and better-auth already keeps attempt counts on the verification row.
