# @ea/modules

Every feature, one package. The directory shape is **slice × role × concept**:

```
<slice>/<role>/<Concept>/<Concept>.<facet>.ts     one facet of a concept
<slice>/<role>/<Concept>/<Operation>.ts           one business operation
```

Rings (`domain`, `tables`, `use-cases`, `server`, `api`) are lowercase; concepts are PascalCase.

There is **no `"."` export**, on purpose. Importing `@ea/modules` would pull every ring of every
slice into one module graph, including `server/`. Name what you want:

```ts
import { DocumentParser } from "@ea/modules/intake/domain/Document"
import { Db } from "@ea/modules/shared/tables/Database"
```

## The rings

| Ring        | Holds                                                              | May import                                                        |
| ----------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `domain`    | models, errors, ports, pure logic                                  | `effect` only (`effect/http-api` counts — it is a contract DSL)   |
| `tables`    | migrations, row schemas                                            | `effect/sql`, never a driver                                      |
| `use-cases` | one file per business operation, plus `.rpc.ts` transport surfaces | domain, tables                                                    |
| `server`    | platform-coupled adapters                                          | anything, but nothing may import _it_ except the composition root |
| `api`       | the composed versioned wire contract                               | each slice's domain                                               |

`bun run dep:check` enforces all of that, plus: a slice may not reach into another slice (two
allow-listed composition points excepted), and `apps/worker/src/Main.ts` is the only file that may
name a `server` ring.

Because one package means the module graph no longer keeps `better-auth` and `pg` out of a browser
bundle, the **bundle assertion** in CI is the backstop for browser safety rather than a formality.
