// The concept's curated public surface. `"./*": "./*/index.ts"` in package.json makes
// this the only way in, and `"./internal/*": null` makes anything else unresolvable.
export * from "./RoomFrame.ts"
export * from "./RoomName.ts"
export * from "./Rooms.ts"
