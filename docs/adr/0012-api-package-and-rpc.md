# ADR-0012 — The API is its own versioned package, and carries two transports

**Status:** accepted · **Date:** 2026-09-28

## Context

The versioned contract lived at `packages/modules/shared/api`, as a fourth ring inside the modules
package (ADR-0010, bend 2). Two problems with that, one structural and one practical:

- **It is versioned on a different clock from the features behind it.** A `v1` endpoint has to keep
  working while the domain shape under it is refactored freely. Putting the contract in the same
  package as the features invites the two to move together, which is precisely what the frozen wire
  boundary exists to prevent.
- **A client should be able to depend on the contract without depending on every module.** The
  Laravel consumer needs the OpenAPI document; our own console needs the RPC group. Neither needs
  `@ea/modules`, and with one package they had no way to say so.

Separately: the product needs an RPC surface for its own frontend. The public HTTP API is
deliberately frozen and hand-mapped, which is the right cost for callers we do not control and pure
overhead for a console that ships in the same build.

## Decision

**`packages/api` is a workspace package**, with `v1/` inside it and no `"."` export. It holds the two
manifests, the transport edge, and the API's own liveness contract:

```
packages/api/v1/
  V1.api.ts            the HttpApi manifest — collects every module's HttpApiGroup
  V1.rpc.ts            the RpcGroup manifest — collects every module's RpcGroup
  Health/Health.wire.ts the deployment's own liveness contract
  Identity/Identity.{http,rpc}.ts   the transport edge
  Intake/Intake.{http,rpc}.ts
```

Each slice still owns its own groups, beside the types they carry
(`modules/<slice>/domain/<Concept>/<Concept>.{wire,rpc}.ts`). The api package collects them and
nothing more — adding a slice to the product is a one-line diff in a manifest, and an unexposed slice
is visibly unexposed.

### Two transports, one seam

|                  | `HttpApi` (`*.wire.ts`)                         | `RpcGroup` (`*.rpc.ts`)                    |
| ---------------- | ----------------------------------------------- | ------------------------------------------ |
| Caller           | anyone: the Laravel client, a customer's script | our own console, deployed together         |
| Schemas          | frozen, snake_case, hand-mapped from the domain | **domain types directly**, camelCase       |
| Breaking changes | never; a v2 is a new path                       | fine — client and server ship in one build |
| Shape            | REST-ish resources, OpenAPI, Scalar docs        | methods, batching, streaming               |

Both mount on the **same router**, so there is one origin, no CORS, one deploy — and both resolve to
the same `CurrentUser`. `Session.live.ts` exposes one `resolveIdentity(config, headers)` and two thin
layers over it, so "one authorization seam" is a fact rather than two implementations that agree
today. Taking headers rather than an `HttpServerRequest` is what makes that possible; the RPC
middleware is handed `options.headers` and never sees an HTTP request.

## Consequences

**The transport edge had to move into the api package, and that was forced rather than chosen.**
`HttpApiBuilder.group(api, id, build)` needs the whole `HttpApi` value, so a handler living in a
module would make modules and api mutually dependent. RPC has no such constraint —
`group.toLayer(...)` needs only the group — so the asymmetry belongs to the HTTP builder. The
`use-cases` ring is better for it: it now holds business operations only, with no transport at all,
which is what makes the fakes-only test tier straightforward.

**`dep:check` grew a rule for the cycle**, because it does not fail loudly. The api barrel re-exports
the handler files; a handler that imports `ApiV1` from `@ea/api/v1` instead of `../V1.api.ts` gets
`undefined`, and every request dies with `Cannot read properties of undefined (reading 'groups')`.
That cost twenty minutes once; the rule means it cannot cost it twice.

**Two facets were renamed.** `.rpc.ts` used to mean "HTTP handlers" in the use-cases ring, which real
RPC needed. HTTP handlers are now `.http.ts`. The rule: **in `domain` a facet is a declaration; in
`api` it is the implementation of that declaration.**

### Two bugs this work surfaced, both worth recording

1. **`RpcServer.layerHttp` mounts a WebSocket when `protocol` is omitted.** Despite the name:
   `options.protocol === "http" ? layerProtocolHttp(options) : layerProtocolWebsocket(options)`. A
   plain POST gets a 404 with nothing in the logs. Always pass `protocol: "http"` explicitly.

   _Amended 2026-10-05 by [ADR-0026](0026-rpc-server-per-request.md):_ `layerHttp` is no longer used. Mounted
   that way, the server is forked inside the isolate's first request, and it never started when that request did
   no I/O, so every later RPC call hung. The server is now built per request.
2. **RLS was doing nothing, in every environment.** The first `Intake.list` test returned another
   organization's rows. Two independent causes, both fixed:
   - The query relied on RLS alone; the plan's app-layer predicate was missing. Added.
   - **The Worker connects as a superuser locally, and a superuser bypasses RLS whatever `FORCE`
     says.** `Db.scoped` now issues `set local role effect_ai_app` inside its transaction, so the
     policies apply regardless of who connected. Verified by deleting the app-layer predicate and
     confirming the cross-tenant test still passes on RLS alone — which is what "neither is trusted
     alone" is supposed to mean.

   The tenancy suite did not catch this because it deliberately connects as the app role. A test that
   arranges the safe conditions cannot discover that production does not arrange them.

## Revisit when

A second API version exists, and `v1`/`v2` need different module versions rather than different
manifests — at which point the version, not the package, becomes the unit of release.
