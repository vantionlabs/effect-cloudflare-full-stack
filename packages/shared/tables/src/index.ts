// The package root. Prefer the per-concept subpath (`@ea/x/Concept`) at call sites:
// it says which concept a symbol belongs to, which the namespace import cannot.
export * as Database from "./Database/index.ts"
export * as Tenancy from "./Tenancy/index.ts"
