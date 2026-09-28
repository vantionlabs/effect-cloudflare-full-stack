// The concept's curated public surface. `"./*": "./src/*/index.ts"` in package.json makes
// this the only way in, and `"./internal/*": null` makes anything else unresolvable.
export * from "./Identity.wire.ts"
