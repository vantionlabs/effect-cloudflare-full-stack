// Flat re-export: consumers import { ApiV1, HealthV1 } from "@ea/shared-domain/api".
// v1 is the only version; a future v2 gets its own subpath rather than shadowing this.
export * from "./v1/index.ts"
