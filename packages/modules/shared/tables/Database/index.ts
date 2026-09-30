// The concept's curated public surface. `"./*": "./*/index.ts"` in package.json makes
// this the only way in, and `"./internal/*": null` makes anything else unresolvable.
//
// `Migrations` is deliberately NOT here, and it used to be. A barrel re-exports every file beside it, so
// exporting the migration manifest from the same place as the `Db` seam meant anything importing `Db` pulled in
// every slice's table definition — and the console imports `Db` transitively through `@ea/api`'s `Serve.ts`. The
// browser bundle therefore contained the entire database schema. Found by `bun run bundle:check` on its first
// run; the manifest now lives in `shared/tables/Migrations`.
export * from "./Connect.ts"
export * from "./Db.ts"
export * from "./TextArray.ts"
