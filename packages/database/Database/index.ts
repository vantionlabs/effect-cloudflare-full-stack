// The package's public surface: `@ea/database/Database`.
//
// `Migrations` is deliberately NOT here, and it is not even in this package. A barrel re-exports every file beside
// it, so while the migration manifest sat next to the `Db` seam, anything importing `Db` pulled in every slice's
// table definition — and the console imports `Db` through `@ea/api`'s `Serve.ts`, so the browser bundle contained
// the entire database schema. `bun run bundle:check` found it.
//
// The manifest stayed in `@ea/modules/shared/tables/Migrations` for a second reason: it imports every slice's
// table file, so moving it into a capability package would invert the layout this package exists to enforce
// (ADR-0021). A list of features belongs with the features.
export * from "./Connect.ts"
export * from "./Db.ts"
export * from "./TextArray.ts"
