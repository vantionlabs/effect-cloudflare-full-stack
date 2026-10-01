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
export * from "./ApiV1.ts"
export * from "./Ask/AskHttp.ts"
export * from "./Ask/AskRpcLive.ts"
export * from "./Assistant/AssistantRpcLive.ts"
export * from "./Chat/MessageHttp.ts"
export * from "./Chat/RoomHttp.ts"
export * from "./Data/DataRpcLive.ts"
export * from "./Decision/DecisionHttp.ts"
export * from "./Decision/DecisionRpcLive.ts"
export * from "./Frames.ts"
export * from "./Health/HealthHttp.ts"
export * from "./Health/HealthWire.ts"
export * from "./Identity/IdentityHttp.ts"
export * from "./Identity/IdentityRpcLive.ts"
export * from "./Intake/IntakeHttp.ts"
export * from "./Intake/IntakeRpcLive.ts"
export * from "./Planning/PlanningRpcLive.ts"
export * from "./Realtime/MessageRpcLive.ts"
export * from "./Realtime/RoomRpcLive.ts"
export * from "./RpcV1.ts"
export * from "./Sales/SalesRpcLive.ts"
export * from "./Usage/UsageHttp.ts"
export * from "./Usage/UsageRpcLive.ts"
