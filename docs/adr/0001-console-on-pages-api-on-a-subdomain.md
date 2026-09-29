# ADR-0001 — The console on Cloudflare Pages, the API on its own subdomain

**Status:** accepted · **Date:** 2026-09-29 · **Supersedes** the unwritten "single Worker with Assets"
decision that `PLAN.md` recorded and that was implemented until now.

## Context

The console was served by the API Worker through the `assets` binding: one deploy, one origin. The reasons
were real and are worth restating, because they are what is being traded:

- **No CORS on the first-party path**, no cookie-domain setting, no trusted-origins list — the three
  settings most likely to be subtly and silently wrong.
- **Assets served before the Worker runs**, so static files cost no invocation.
- **One deploy, one rollback**, so the console and the API cannot disagree about the RPC contract.

Two decisions were then taken, and the second changes more than the first:

1. **The console deploys to Cloudflare Pages.**
2. **The API is its own subdomain** — `api.example.com` serving `app.example.com` — because that is what a
   real-world application does.

The second is the substantive one. An API-first product whose second consumer is somebody else's Laravel
application wants a hostname that is obviously the API, not a path on the web app. And the moment the API
has its own hostname, "one origin" is gone regardless of where the console is hosted.

## Decision

**The console is a Pages project. The API is a Worker on `api.<domain>`. The three cross-origin settings
are turned on together, or not at all.**

### The three settings, and why they are one switch

| Setting                                              | Where                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| CORS with an explicit origin and `credentials: true` | `Main.ts`, `HttpRouter.cors`, only when `CONSOLE_ORIGIN` is set |
| better-auth `trustedOrigins`                         | `BetterAuth.ts`, only when `consoleOrigin` is set               |
| Cookie `Domain=.example.com`                         | `BetterAuth.ts`, only when `cookieDomain` is set                |

**A deployment with two of the three logs a user in and then silently logs them out.** The cookie is set for
a host the browser will not send it to, or the credentialed request is refused by the browser before the
server sees it — and in neither case is there anything in a log. So they are read from configuration that is
absent by default, and the absence means same-origin rather than a half-configured cross-origin.

Two specifics that are easy to get wrong and expensive to debug:

**`Access-Control-Allow-Origin: *` is invalid with credentials.** Browsers refuse the response. A wildcard
here is not lax, it is broken while looking permissive. So the origin is an explicit allowlist.

**Sibling subdomains are the same _site_, not merely the same domain.** `app.example.com` and
`api.example.com` share a registrable domain, so `Domain=.example.com` works and `SameSite=Lax` still
applies — no `SameSite=None`, no third-party-cookie territory, nothing that depends on a browser default
being reversed. This is the reason a subdomain API is workable where a genuinely cross-site one is not.

### The interim, because there is no domain yet

`wrangler` reports **zero zones on this account** (verified against the API, not assumed). Without a custom
domain, Pages is `*.pages.dev` and the Worker is `*.workers.dev` — **different registrable domains**, so no
`Domain` value can bridge them and the only cookie that would work is `SameSite=None`, which browsers are
actively restricting.

So until a domain exists, the console keeps same-origin by proxying: `functions/api/[[path]].ts` forwards
`/api/*` to the Worker over a **service binding**, which is Worker-to-Worker inside Cloudflare's network —
no public request, no egress, no token. `public/_routes.json` restricts Function invocation to `/api/*`, so
every other request is still served as a static asset at no invocation cost, which is the one property of
the `assets` binding worth keeping.

The request is forwarded **unchanged**. A service binding's `fetch` takes a real `Request`, so the Worker
sees the original URL and therefore the original host — which is what makes the session cookie land on the
host the browser actually visited. Rebuilding the request would also drop the body on anything but `GET`,
and an upload is a `POST` of raw bytes: the failure would not be an error but an empty document that parses
to an empty string and extracts nothing.

`VITE_API_ORIGIN` is what selects between the two shapes in the console, and it is a build-time value
because an app that has to ask where its API is cannot render until it knows.

## What this costs, stated plainly

- **Two deploys**, and they can disagree. RPC carries domain types rather than a frozen wire schema — that
  was justified by the console and the server shipping together, which is now less true. Mitigation is the
  same as plan risk R11 named: gradual deployments with version pinning.
- **Three settings that can be wrong**, where previously there were none. Coupled into one switch above.
- **An extra hop** in the interim shape. In-network, and it disappears when the subdomain lands.

## What it buys

- **An API that looks like an API**, which matters for the second consumer and for API keys later.
- **Independent rollback** of the console, which plan risk R11 recorded as the reason this split was a
  pre-approved escape hatch rather than a reversal.
- **Pages' own build and preview flow** for the front end.

## Revisit when

- **A domain is registered.** Then uncomment the `routes` block in `apps/worker/wrangler.jsonc`, set
  `CONSOLE_ORIGIN`, `COOKIE_DOMAIN` and `VITE_API_ORIGIN` **together**, and delete
  `functions/api/[[path]].ts` — leaving both paths live means two ways for auth to work and therefore two
  ways for it to break.
- **The console and the API drift apart.** If a deploy ever ships a console against an incompatible RPC
  group, the answer is a versioned RPC surface, not a return to one deploy.
- **Cloudflare's guidance on Pages changes.** A claim was made earlier in this project's history that
  Cloudflare "directs new projects to Workers rather than Pages" and that Pages is effectively in
  maintenance. **That was checked against the documentation and is not supported**: the
  [Pages-to-Workers guide](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
  is written for existing Pages users and states no deprecation, and service bindings and `_routes.json` are
  both documented as supported. Pages is a fine bet today.

  What the docs _do_ say, and it is worth knowing since this ADR depends on it: the migration guide
  recommends against **file-based routing via a `functions/` folder** specifically — _"we do recommend
  considering using another framework if you wish to continue to use file-based routing"_. Our one Function
  is a three-line proxy that exists only until a domain is registered, at which point it is deleted, so this
  is a short-lived dependency on the discouraged part rather than an architecture built on it. If it outlives
  its welcome, the console moves to Static Assets on its own Worker — which keeps the subdomain split, since
  that is the decision that actually mattered here.
