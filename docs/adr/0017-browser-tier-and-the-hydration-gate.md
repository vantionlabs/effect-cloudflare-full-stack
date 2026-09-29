# ADR-0017 — A browser tier, and controls disabled until hydrated

**Status:** accepted · **Date:** 2026-09-29

## Context

PLAN.md's testing table has four tiers — domain, use case, adapter (real `workerd` plus a real Postgres),
and eval — chosen by what each needs rather than where it lives. Nothing in that table can observe the
console's auth, and after the move to TanStack Start the console's auth is where the interesting failures
are. Two had already shipped and been fixed blind, by reading code and curling a deployed origin:

- a deployed sign-up returning **403 INVALID_ORIGIN**, because `BASE_URL` was unset and defaulted to
  localhost;
- a session cookie with **no `Secure` flag**, because the service-binding dispatch is internal so
  `request.url` is `http://`.

Both are properties of the _topology_ — one Worker setting a cookie that another reads on the next request,
over an origin a browser actually visited. A unit test cannot see them, and the `worker` suite asserts on
responses rather than on what a browser then does with them.

## Decision

**A fifth tier: Playwright against the real pair of Workers.** `e2e/` is a workspace; `bun run test:e2e`
starts the console's dev server, which boots the API as an auxiliary Worker, and drives Chromium through it.
`E2E_BASE_URL` points the same specs at staging instead, which is the only place the real cookie attributes
(`__Secure-`, `Secure` over https) can be observed at all.

Gated in CI on `CLOUDFLARE_API_TOKEN`, with a warning when it is absent, exactly as the `worker` project is
and for the same reason: the API's `ai` binding has no local emulation, so wrangler starts a remote runtime
and refuses without a token. A suite that quietly skips itself is worse than one that visibly does not run.

Six specs, each for something no other tier can reach: the guest redirect **and its 307 status** (a 200 with
a client-side bounce means the shell was sent to a stranger and then corrected); sign-in; that signing out
clears the session rather than only the screen; that the SSR payload carries the session's data but **not**
its token; that a refused credential is reported in the server's own words; and that with JavaScript off the
form cannot submit a password at all.

**And: every control whose behaviour is JavaScript is disabled until hydration.** That is a product decision
this tier forced, not a testing convenience. The suite raced hydration by accident on its first run and
surfaced three distinct bugs in the window before the bundle loads — a typed value discarded when React
re-renders a controlled input from empty form state; a native GET submit appending the **password to the
URL**, into history and every access log in front of the app; and a `Sign out` click that silently did
nothing, leaving somebody believing they had signed out. `useHydrated` plus `disabled={!hydrated}` closes
all three, with `method="post"` on the form as insurance no other entry point can defeat.

It doubles as the test signal. Playwright waits for a control to be enabled before acting, so "hydrated"
becomes something a test waits on rather than sleeps through — which is why there is no `waitForTimeout`
anywhere in the suite, and why adding one would reintroduce exactly the race that found the bugs.

## Consequences

- **Serial, one worker, no retries.** These specs sign users up against one Postgres, and the realistic
  flake is a genuine race in the very sequence under test. `retries: 2` would convert the one bug this tier
  is best placed to find into a green run.
- **A gate that can be skipped is a gate that will be.** If `CLOUDFLARE_API_TOKEN` is never added to the
  repository, this tier never runs in CI and the warning is all anyone sees. That is a real cost, accepted
  because the alternative — a local-only suite with no CI story — is worse, and because the same token
  already gates the `worker` project.
- **Chromium only.** The suite tests cookies, redirects and payload contents, which do not differ by engine.
  A second browser would triple the runtime to re-assert the same facts.
- **A disabled form on first paint.** In production that window is short; with JavaScript off it is
  permanent, which is honest — sign-in here needs the better-auth client.

## Revisit when

- **A spec is about layout or an engine-specific API** — then add a second browser, because the reason for
  Chromium-only has stopped holding.
- **The suite exceeds about two minutes, or a spec needs another's user** — then fixtures and parallelism
  are worth the cost that serial execution currently avoids.
- **Sign-in becomes progressively enhanced** (a server function handling a real form POST) — then the
  hydration gate on the login form is no longer the right answer, because the degraded path would work
  rather than merely be safe. The gate on `Sign out` would still stand.
- **`retries` gets proposed.** Read the reason above first, then look for the race.
