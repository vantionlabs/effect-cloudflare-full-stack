# Extract `@ea/realtime`, payload-agnostic

Status: done
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

## Comments

**2026-09-30 — done.**

```
packages/realtime/Room/      RoomName, Rooms(opaque), RoomIdentity, REALTIME_PATH, PING/PONG
packages/realtime/Presence/  Viewer, Viewing, Welcome, Presence + its own codec
packages/realtime/Server/    RoomProtocol, RealtimeUpgrade, RoomsLive
packages/realtime/test/      the protocol tests, which moved with the code
packages/modules/chat/       the feature, renamed from `realtime`
packages/api/v1/Frames.ts    the union and the codec
```

`QueueChanged` went to `decision/domain/Decision/DecisionFrame.ts`, where it always belonged — a transport that
could name it was a transport that knew about decisions.

Two things the split forced, both improvements:

- **`Viewing` carries `viewing`, not `decisionId`.** The transport cannot know whether a client is looking at a
  decision or a channel, so the field is opaque and the caller decides what it means. A test caught the rename.
- **Presence keeps its own codec**, separate from the application union. The room sends `Welcome` and `Presence`
  itself, with no slice involved, so it must be able to encode them without importing the manifest — while the
  CLIENT decodes one union, which is where both halves meet.

The protocol tests moved to `packages/realtime/test` and joined vitest's `domain` project: they need nothing but
Node, which is the whole reason that logic was lifted out of the Durable Object class in the first place.
