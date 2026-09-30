# The public REST surface

A review of `packages/api` against REST conventions and against what `docs/PLAN.md` already promises,
done 2026-09-30.

## What the surface is today

`ApiV1` is a real `HttpApi` under `/api/v1`, with three endpoints, and a separate RPC surface at
`/api/rpc/v1/` carrying domain types for the console:

| Method | Path                   | Notes                                                     |
| ------ | ---------------------- | --------------------------------------------------------- |
| GET    | `/api/v1/health`       | unauthenticated, by design                                |
| GET    | `/api/v1/me`           | behind `Authenticated`                                    |
| POST   | `/api/v1/intakes`      | raw body, metadata in the query string, typed 415 refusal |
| GET    | `/api/v1/openapi.json` | generated from the same declaration that types handlers   |
| GET    | `/api/v1/docs`         | Scalar, added by this review                              |

The conventions that were already right, and are worth naming so nobody "fixes" them: plural collection
nouns (`/intakes`); a frozen snake_case wire schema per version, never a re-exported domain type; a typed
415 that names what IS supported rather than the framework's plain-text default; and one prefix per
version so a v2 cannot shadow v1.

## Fixed by this review

- **`POST /intakes` answered 200.** It is asynchronous — the document is stored, an event is enqueued, and
  the decide pipeline runs on a queue consumer after the response is written — so 200 told a client the
  work was done. It is 202 now, which also makes the status agree with the body's name
  (`UploadAcceptedV1`). Pinned by a test over the generated OpenAPI document, which resolves status
  through the same `HttpApiSchema.getStatusSuccessSchema` the response encoder uses.
- **The document had no title, version or description**, so it introduced itself to an integrating client
  as `effect-ai-v1` at version `0.0.1`. Annotated. The version is the CONTRACT's, and a test says so,
  because the build's version is `HealthV1.version` and conflating the two makes a frozen API look like it
  moves on every deploy.
- **Nothing rendered the document.** `openapi.json` was served and unread; Scalar now renders it at
  `/api/v1/docs`, from the CDN rather than inlined into the Worker script.

## What is still missing, and why each is its own issue

The gap that matters is not a convention — it is that **the asynchronous contract is half-built**. A
caller can POST an intake and receive 202 with two ids, and there is no REST way to read what happened.
`docs/PLAN.md` names the missing half explicitly: _"the caller polls `GET /api/v1/decisions?intake_id=…`
(slice 1) or receives an HMAC-signed webhook (slice 1.5)"_.

That is `01`. `02` is that no third party can authenticate at all, and `03` is that a collection endpoint
cannot be added honestly until paging has one shape. They are ordered that way on purpose: `01` is useless
without `02`, and `02` is pointless without `01`.

Out of scope here, and already tracked elsewhere: webhooks (PLAN slice 1.5), and the RPC surface, which is
deliberately not REST — it ships with the console, carries domain types, and is versioned by the same
prefix rule.

## Scope decided 2026-09-30

**Full REST parity — all 16 RPC operations get a path — and `X-API-Key` in the same pass.** Measured before
deciding: the OpenAPI document described **3 of 19 operations**, because `Ask`, `Decision`, `Message` and
`Room` are RPC-only and RPC has no per-method URL (one `POST /api/rpc/v1`, method in the envelope).

The two halves are one pass on purpose: endpoints only a session cookie can reach are unusable by the
integrating client they exist for, and the console already has RPC. Shipping reads without key auth would add
17 paths that nothing outside a browser can call.

RPC stays. It is not replaced by this — it carries domain types for the console and is versioned by the same
prefix rule (ADR-0012). What changes is that the _public_ surface stops being a third of the product.

Build order, each stage green on its own:

| Stage | What                                                                               | Issue |
| ----- | ---------------------------------------------------------------------------------- | ----- |
| A     | the paging shape, and cursors in the list use cases                                | 03    |
| B     | frozen wire types + the 8 read endpoints                                           | 01    |
| C     | the 9 write endpoints, with approve/reject routed to the existing single emit site | 04    |
| D     | `X-API-Key` resolving to the same `Identity`, plus CORS scoped to that path        | 02    |
