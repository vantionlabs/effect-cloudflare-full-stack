# Extract `@ea/realtime`, payload-agnostic

Status: ready-for-agent
Blocked by: 01

The transport currently knows what a chat message is: `RoomFrame.ts` imports `Message`, and `Rooms.broadcast` takes
a `ServerFrame`. Extracting it as-is would make a capability package depend on a feature.

## The shape

- `@ea/realtime` owns `RoomName`, the `Rooms` port with `broadcast(room, payload: string)`, the presence protocol
  (`Viewer`, `Welcome`, `Presence`), `PING`/`PONG`, `RoomProtocol` and `RealtimeUpgrade`.
- Each slice owns its frames: chat keeps `MessagePosted`, `MessageChanged`, `RoomsChanged`; `QueueChanged` goes to
  `decision/domain`, which is where it always belonged.
- `packages/api/v1/Frames.ts` assembles the union, exactly as `RpcV1.ts` assembles the RPC groups. The console
  decodes with the assembled union.

## Why this is an improvement rather than a workaround

A transport that cannot name a `QueueChanged` is a transport. The union has to be assembled somewhere, and the repo
already has the pattern and the place for it.

## Done looks like

`@ea/realtime` imports no slice. The console imports frames from `@ea/api`. The room tests still pass unchanged —
they exercise the protocol, which does not move.
