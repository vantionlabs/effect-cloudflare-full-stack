# Verify a WebSocket upgrade survives a service binding

Status: ready-for-agent
Type: research

The console forwards `/api/*` to the API over a service binding (`apps/console/src/server.ts`), and that
one-origin property is load-bearing: it is why the session cookie is first-party and why there is no CORS
anywhere (ADR-0001). A chat socket would take the same path, so a 101 response with a `webSocket` has to
pass back through `env.API.fetch(request)` intact.

Unverified. Cloudflare documents WebSockets from a Worker to a Durable Object thoroughly and says much less
about a 101 crossing a service binding.

## Done looks like

- A minimal upgrade route on the API reached **through the console's binding** locally (the auxiliary-Worker
  dev setup already boots both), with a frame echoed end to end.
- A row in `docs/references.md`.
- If it does not pass through: confirm the documented alternative — the console binds the DO namespace
  directly using `script_name` — and record what that costs, which is at least that two Workers then both
  need the namespace declared and migrated.

## Trap to avoid

Do not "fix" a failure here by moving chat to its own hostname. That reintroduces cross-origin cookies, a
trusted-origins list and a cookie `Domain` — the three coupled settings ADR-0001 exists to avoid, and the
ones that already produced a 403 INVALID_ORIGIN in this repo once.
