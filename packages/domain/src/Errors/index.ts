// The concept's curated public surface. `"./*": "./*/index.ts"` in package.json makes
// this the only way in, and `"./internal/*": null` makes anything else unresolvable.
//
// Only the PRIMITIVE failure lives here. `Unauthenticated` is "nobody is signed in", which every layer can produce
// and none of them owns. A slice's own failures — `UnsupportedDocument`, `RailsRefused`, and the terminal-tag list
// that names other slices as strings — stay in `@ea/modules/shared/domain/Errors`, because they are statements
// about this product rather than about identity.
export * from "./RateLimited.ts"
export * from "./Unauthenticated.ts"
