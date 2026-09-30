# Extract `@ea/database`

Status: done
Blocked by: 01

`Db`, `Connect` and `TextArray` out of `modules/shared/tables/Database`, which is a path that says "shared tables"
for something that is neither.

## What does NOT move

`Migrations.ts`, which already has its own concept folder. It imports every slice's table file, so moving it into a
capability package would invert the whole layout — it is a manifest of features, like `RpcV1`.

## Note before starting

This moves no dependency: `Db`, `Connect` and `TextArray` import only `effect` and `effect/sql`. It is a taxonomy
fix and a shorter import path for about forty files. Do not write a commit message claiming a dependency win.

## Done looks like

`@ea/database` depends on `effect` only. `dep:check` forbids it from importing `@ea/modules`, negative-tested. The
forty importers say `@ea/database`.

## Comments

**2026-09-30 — done.** `packages/database/Database` holds `Db`, `Connect` and `TextArray`; 38 files rewritten to
`@ea/database/Database`.

As the issue warned, this moved **no dependency**: the manifest is `@ea/domain` and `effect`. The driver stays in
`apps/worker` (`HyperdriveConnect`, over a `cloudflare:sockets` Duplex) and reaches the package through the
`Connect` port, which is what lets a Node script and a Worker share one seam.

`Migrations` stayed in `@ea/modules/shared/tables/Migrations` for the reason the issue gave — it imports every
slice's table file, so moving it into a capability package would invert the layout — and for a second one the
bundle check had already taught us: a barrel is transitive, and that manifest next to the `Db` seam is what put the
whole schema in the browser.
