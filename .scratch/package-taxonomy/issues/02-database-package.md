# Extract `@ea/database`

Status: ready-for-agent
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
