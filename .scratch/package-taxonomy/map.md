# Package taxonomy — execution

The decision is ADR-0021. This is the order it has to happen in, and the order is forced rather than chosen.

## Notes

`@ea/database` cannot be extracted before `@ea/domain`, because `Db.scoped` requires `CurrentUser` and
`CurrentOrg`. `@ea/realtime` cannot be extracted before the transport is payload-agnostic, because `RoomFrame`
imports chat's `Message`. Everything else is mechanical.

## Decisions so far

- **ADR-0021** — three kinds of package, with the rule: a package contains a dependency or forbids a direction; a
  ring orders code inside one deployable.
- **The heavy dependencies are better-auth/pg and @effect/ai-openai**, in two files — not in the database seam, as
  first assumed. So integration packages are the split that contains something, and the capability packages are a
  taxonomy fix.
- **The bundle check stays** regardless: it found a leak inside a single package, and that failure mode survives
  any split.

## Fog

- Whether `Authenticated` and `AuthenticatedRpc` belong in `@ea/domain` or in `@ea/api`. They are middleware tags,
  declared beside `Identity` today. Decide when moving identity, not before.
- Whether `shared/domain/Errors` splits: `Terminal.ts` names other slices' tags as strings deliberately, which is a
  feature concern, while `Unauthenticated` is a primitive.
