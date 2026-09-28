// The v1 contract and transport surface.
//
// `@ea/api/v1` is what a client imports: the Laravel consumer takes the OpenAPI document derived from
// `ApiV1`, and our own console takes `RpcV1`. That is the reason this is a package rather than a ring
// inside `modules` — a client depends on the contract, not on every slice's implementation.
//
// It also owns the transport EDGE, not only the manifests, and that is forced rather than chosen:
// `HttpApiBuilder.group` needs the whole `HttpApi` value, so a handler living in a module would make
// modules and api mutually dependent. Worth noting that RPC has no such constraint — `group.toLayer`
// needs only the group — so the asymmetry belongs to the HTTP builder, not to this layout.
export * from "./Health/Health.wire.ts"
export * from "./Identity/Identity.http.ts"
export * from "./Identity/Identity.rpc.ts"
export * from "./Intake/Intake.http.ts"
export * from "./Intake/Intake.rpc.ts"
export * from "./V1.api.ts"
export * from "./V1.rpc.ts"
