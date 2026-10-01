# Effect v4 API notes — GENERATED, do not edit

Regenerate with `bun run effect:verify` after every effect bump.

- **Installed version:** `4.0.0`
- **`unstable/` prefix present:** no
- Generated: 2026-10-01 (export map identical to rc.118's; the import checks below re-run at 4.0.0)

## Module specifiers to import from

| Module          | Import specifier                                    | Source   |
| --------------- | --------------------------------------------------- | -------- |
| `ai`            | `effect/ai`                                         | explicit |
| `http`          | `effect/http`                                       | explicit |
| `http-api`      | `effect/http-api`                                   | explicit |
| `httpapi`       | `effect/httpapi  (via wildcard — verify by import)` | wildcard |
| `rpc`           | `effect/rpc`                                        | explicit |
| `sql`           | `effect/sql`                                        | explicit |
| `schema`        | `effect/schema`                                     | explicit |
| `workflow`      | `effect/workflow`                                   | explicit |
| `cluster`       | `effect/cluster`                                    | explicit |
| `persistence`   | `effect/persistence`                                | explicit |
| `observability` | `effect/observability`                              | explicit |
| `socket`        | `effect/socket`                                     | explicit |
| `net`           | `effect/net`                                        | explicit |

## Full export map (28 paths)

- `.`
- `./*`
- `./*/index`
- `./ai`
- `./cli`
- `./cli/internal/*`
- `./cluster`
- `./cluster/internal/*`
- `./devtools`
- `./encoding`
- `./eventlog`
- `./http`
- `./http-api`
- `./index`
- `./internal/*`
- `./net`
- `./observability`
- `./package.json`
- `./persistence`
- `./process`
- `./reactivity`
- `./rpc`
- `./schema`
- `./socket`
- `./sql`
- `./testing`
- `./workers`
- `./workflow`

## Verified by import (not just the export map)

Confirmed present at `4.0.0-rc.118`, and again at `4.0.0` on 2026-10-01, by actually importing:

| Module            | Symbols                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `effect`          | `Effect` `Layer` `Schema` `Context` `Stream` `Option` `Exit` `Cause`                                            |
| `effect/http`     | `HttpRouter` `HttpServerRequest` `HttpServerResponse` `HttpEffect` `FetchHttpClient` `HttpClient`               |
| `effect/http-api` | `HttpApi` `HttpApiGroup` `HttpApiEndpoint` `HttpApiBuilder` `HttpApiMiddleware` `HttpApiClient` `HttpApiScalar` |
| `effect/ai`       | `LanguageModel` `Tool` `Toolkit` `EmbeddingModel` `Prompt`                                                      |
| `effect/sql`      | `SqlClient` `SqlSchema` `Migrator` `Statement` `SqlError`                                                       |
| `effect/schema`   | `Model` `VariantSchema`                                                                                         |
| `effect/workflow` | `Workflow` `Activity` `DurableDeferred` `DurableClock` `WorkflowEngine`                                         |

`HttpEffect` exports: `fromWebHandler`, `toWebHandler`, `toWebHandlerLayer`,
`toWebHandlerLayerWith`, `toWebHandlerWith`. `HttpRouter.toWebHandler` is also a function.

### Corrections to earlier assumptions

- **`Model` / `VariantSchema` live in `effect/schema`, NOT `effect/sql`.**
- **`Context`, not `ServiceMap`** — `ServiceMap` does not exist at this version, so
  `Context.Service<Self, Shape>()("Tag")` is the idiom.
- **`effect/http-api` is hyphenated**; `effect/httpapi` is not an explicit export.
- **`effect/ai` ships `EmbeddingModel`**, so the `Embedder` port can wrap Effect's own
  abstraction rather than being hand-rolled over raw HTTP.
- `./*/index` is mapped to `null`, so import `effect/http`, never `effect/http/index`.

### Toolchain coupling found at install time

`@effect/tsgo@0.46.1` supports **oxlint 1.82.0–1.85.0 only** and refuses 1.86.0. So oxlint's
version is dictated by tsgo, not chosen freely — pinned to `1.85.0`. `effect-tsgo patch --oxlint`
also requires `oxlint-tsgolint` to be installed.
