# Extract `@ea/domain`

Status: ready-for-agent

Identity and ids are primitives every layer shares, and `@ea/database` cannot be extracted until they have a home
that does not import features — `Db.scoped` requires `CurrentUser` and `CurrentOrg`.

## Moves

- `shared/domain/Identity/*` → `packages/domain/Identity/*`
- `shared/domain/Ids/*` → `packages/domain/Ids/*`

## Decide while doing it

- `Authenticated` and `AuthenticatedRpc` are HttpApi and RPC middleware TAGS that happen to live beside `Identity`.
  They may belong in `@ea/api`. Cheap either way; do not let it block the move.
- `shared/domain/Errors/Unauthenticated.ts` is a primitive; `Terminal.ts` names other slices' tags as strings and is
  a feature concern. They probably separate.

## Done looks like

`packages/domain/package.json` depends on `effect` and nothing else — which is the property being bought, so assert
it by reading the manifest rather than by intending it. `dep:check` gains a rule: nothing in `packages/domain` may
import `@ea/modules`, negative-tested.
