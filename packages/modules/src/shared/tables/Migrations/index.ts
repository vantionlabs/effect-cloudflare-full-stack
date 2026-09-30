// The concept's curated public surface. `"./*": "./*/index.ts"` in package.json makes
// this the only way in, and `"./internal/*": null` makes anything else unresolvable.
//
// Its OWN concept, separate from the `Db` seam, because a barrel is transitive: while these lived together,
// importing `Db` dragged every slice's table definition along, and the console imports `Db` through `@ea/api`.
// A migration manifest is only ever wanted by a script or the Worker's migrate path.
export * from "./Migrations.ts"
