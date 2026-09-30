# Extract `@ea/domain`

Status: done

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

## Comments

**2026-09-30 — done.** `packages/domain` holds `Identity` (with `Authenticated`, `AuthenticatedRpc` and
`IdentityResolver`), `Ids`, and `Errors/Unauthenticated`. 53 files rewritten.

Decisions taken while doing it:

- **`Authenticated`/`AuthenticatedRpc` stay with `Identity`**, not in `@ea/api` as the fog note wondered. They
  cannot live there: modules' `RpcGroup`s call `.middleware(AuthenticatedRpc)`, and `dep:check` forbids modules
  from importing `@ea/api`. The question answered itself.
- **Only `Unauthenticated` came along** from `shared/domain/Errors`. It is "nobody is signed in", which every layer
  can produce and none owns. The rest — `UnsupportedDocument`, `RailsRefused`, and `Terminal.ts`, which names other
  slices' tags as strings on purpose — are statements about this product and stayed.
- **`@ea/domain` is not a dependency of the apps.** knip caught that immediately: an app composes, it does not name
  primitives, so it reaches identity through `@ea/modules` and `@ea/api`.

`dep:check` gained the rule that makes the boundary real — a capability package may not import a feature or the api
package — negative-tested by adding a decision import to `Identity.ts` and watching it fail.
