# Infrastructure

Pulumi program managing the Cloudflare resources, chosen over Alchemy because Alchemy's
current beta cannot load on `effect@4.0.0-rc.118`
(see [`../docs/runbooks/PatchingEffectDeps.md`](../docs/runbooks/PatchingEffectDeps.md)).

**Deliberately plain TypeScript with no Effect dependency.** This program shares nothing with
the Worker, so coupling it to Effect would buy no composition while exposing infrastructure to
every RC churn — exactly what blocked Alchemy. `effect-pulumi` exists but declares
`effect: ^3.0.0`, so adopting it would recreate the problem on purpose. A boundary rule in
`scripts/boundaries.ts` enforces this.

## One-time setup

**1. Install the Pulumi CLI** (a binary, not an npm package):

```bash
brew install pulumi           # or: curl -fsSL https://get.pulumi.com | sh
```

**2. Choose a state backend.** Pulumi Cloud is free for individuals and needs no setup:

```bash
pulumi login
```

Or keep state on Cloudflare with R2 (S3-compatible). Chicken-and-egg: the bucket must exist
first, so create it once by hand and never manage it here.

**3. Create the PlanetScale Postgres cluster.** _Not managed by this program_ — there is no
Pulumi provider for PlanetScale, and the Cloudflare partnership flow is what puts the cluster
on **your Cloudflare invoice**, which is a dashboard action. Create it there
(**PS-5 non-HA is $5/mo and bills daily from creation**), then hand this program its
**direct** connection string:

```bash
pulumi stack init dev
pulumi config set effect-ai:accountId f4599b98c2430a831bcfc291d156a988
pulumi config set --secret effect-ai:postgresUrl 'postgresql://…'   # DIRECT, not pooled
pulumi config set --secret cloudflare:apiToken   '…'
```

Pooled or transaction-mode connection strings break `@effect/sql-pg`'s named prepared
statements, and Hyperdrive does the pooling itself — so the direct string is required, not
merely preferred.

## Use

```bash
bun run infra:preview    # read-only: what would change
bun run infra:up         # apply — costs money
bun run infra:outputs    # binding ids as JSON, for wrangler.jsonc
```

## What it manages

| Resource                   | Why it is shaped this way                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `R2Bucket`                 | Source documents, `WEUR` for EU data residency                                                                                                                                                                                                                           |
| `WorkersKvNamespace`       | better-auth sessions — eventual consistency is correct for sessions and wrong for the review queue, which never touches KV                                                                                                                                               |
| `Queue` + DLQ              | The event engine. A dead letter must land somewhere queryable                                                                                                                                                                                                            |
| **Two** `HyperdriveConfig` | Hyperdrive caches reads 60s by default and **does not invalidate on write**. A reviewer approving a decision then seeing a stale queue would be a bug, so transactional reads use the uncached config and the policy corpus (static between ingests) uses the cached one |

Resource names carry the stack, so `dev` and `production` cannot collide in one account.

## Stacks map 1:1 to Wrangler environments

| Pulumi stack | Wrangler env       | Deployed Worker        | Notes                                                                              |
| ------------ | ------------------ | ---------------------- | ---------------------------------------------------------------------------------- |
| —            | top level          | —                      | Local only. `wrangler dev` against the compose.yaml Postgres; nothing provisioned. |
| `staging`    | `--env staging`    | `effect-ai-staging`    | Every green `main` lands here automatically.                                       |
| `production` | `--env production` | `effect-ai-production` | Never automatic — dispatched by a human.                                           |

**Cloudflare does not inherit bindings into environments:**

> "Non-inheritable keys are configurable at the top-level, but cannot be inherited by
> environments and must be specified for each environment."

So every binding is repeated per environment in `apps/worker/wrangler.jsonc`. Forgetting one
produces a Worker that **deploys successfully and fails at runtime**, so
`bun run bindings:check` asserts each environment declares the same binding names as the top
level, and it runs in `preflight`. It compares names rather than ids, since differing ids per
environment is the entire point.

After `pulumi up`, copy ids into the matching `env.*` block:

```bash
bun run infra:outputs   # then paste hyperdriveId into env.staging / env.production
```

## Migrating back to Alchemy

Re-check on each Alchemy release; adopt when both hold:

```bash
bun add -D alchemy@latest
bun scripts/audit-effect-imports.ts node_modules/alchemy   # must be 0 unresolvable
ls -d node_modules/.bun/effect@*                           # must be exactly one
```

The second check matters more than the first: the blocker was never missing renames, it was
two Effect versions resolving simultaneously across the dependency tree.
